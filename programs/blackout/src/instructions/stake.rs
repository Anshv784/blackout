//! Runs on Solana: the money. Buying a ticket, refunding one, and paying out a finished night.
use anchor_lang::prelude::*;

use crate::config::*;
use crate::error::BlackoutError;
use crate::state::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::anchor::action;

/// Staked rooms: pay the stake into the room bank and get a ticket the ER
/// can verify when you take a seat.
pub fn handle_buy_ticket(ctx: Context<BuyTicket>, room_id: u64, match_no: u32, payout: Pubkey) -> Result<()> {
    let data = ctx.accounts.room.try_borrow_data()?;
    require!(data.len() >= 8 + core::mem::size_of::<Room>(), BlackoutError::BadAccount);
    let room: &Room = bytemuck::from_bytes(&data[8..8 + core::mem::size_of::<Room>()]);
    require!(room.room_id == room_id, BlackoutError::BadAccount);
    require!(room.stake > 0, BlackoutError::NotStaked);
    let stake = room.stake;
    drop(data);
    require!(match_no > ctx.accounts.bank.paid_match, BlackoutError::NeedTicket);
    // a winnings wallet of all zeros is the System Program: paying it would fail the whole settle
    require_keys_neq!(payout, Pubkey::default(), BlackoutError::BadAccount);
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.player.to_account_info(), to: ctx.accounts.bank.to_account_info() },
        ),
        stake,
    )?;
    let t = &mut ctx.accounts.ticket;
    t.room_id = room_id;
    t.match_no = match_no;
    t.player = ctx.accounts.player.key();
    t.payout = payout;
    t.amount = stake;
    t.expires_at = Clock::get()?.unix_timestamp.saturating_add(TICKET_TTL_SECS);
    t.consumed = false;
    let bank = &mut ctx.accounts.bank;
    bank.outstanding = bank.outstanding.checked_add(stake).ok_or(BlackoutError::BadAccount)?;
    bank.tickets = bank.tickets.checked_add(1).ok_or(BlackoutError::BadAccount)?;
    Ok(())
}

/// Close a spent ticket and hand its rent back to its payout wallet. Anyone may call this.
/// Stakes are never refunded: an unused ticket can only be moved to a later night
/// (`reuse_ticket`), and a used one's stake went into its night's pot.
pub fn handle_close_ticket(ctx: Context<CloseTicket>) -> Result<()> {
    require!(ctx.accounts.ticket.consumed, BlackoutError::TicketLocked);
    ctx.accounts.bank.tickets = ctx.accounts.bank.tickets.saturating_sub(1);
    Ok(())
}

/// Carry an unused ticket to the next night of any table with the same stake (the same table,
/// or another). No new stake is paid: the ticket's stake moves with it, bank to bank.
///
/// Only once the old ticket can no longer be in play: its night has settled without it, or it
/// has expired (a night still running is called off before then, see `out_of_time`). A ticket
/// in a lobby that hasn't played yet stays put; it's good for that table's next night as it is.
pub fn handle_reuse_ticket(ctx: Context<ReuseTicket>, room_id: u64, match_no: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let (amount, payout, old_room, old_match) = {
        let old = &ctx.accounts.old_ticket;
        require!(!old.consumed, BlackoutError::TicketLocked);
        require!(old.match_no <= ctx.accounts.from_bank.paid_match || now > old.expires_at, BlackoutError::TicketLocked);
        (old.amount, old.payout, old.room_id, old.match_no)
    };
    let stake = {
        let data = ctx.accounts.room.try_borrow_data()?;
        require!(data.len() >= 8 + core::mem::size_of::<Room>(), BlackoutError::BadAccount);
        let room: &Room = bytemuck::from_bytes(&data[8..8 + core::mem::size_of::<Room>()]);
        require!(room.room_id == room_id, BlackoutError::BadAccount);
        room.stake
    };
    // same stake only: a 0.01 ticket never pays for a 0.05 seat
    require!(stake > 0 && stake == amount, BlackoutError::NotStaked);
    let same_table = old_room == room_id;
    if same_table {
        // one bank: passing it twice would be two copies of the same account
        require!(ctx.accounts.to_bank.is_none(), BlackoutError::BadAccount);
        require!(match_no > ctx.accounts.from_bank.paid_match && match_no != old_match, BlackoutError::NeedTicket);
    } else {
        let to_bank = ctx.accounts.to_bank.as_ref().ok_or(BlackoutError::BadAccount)?;
        require!(to_bank.room_id == room_id, BlackoutError::BadAccount);
        require!(match_no > to_bank.paid_match, BlackoutError::NeedTicket);
    }

    let t = &mut ctx.accounts.new_ticket;
    t.room_id = room_id;
    t.match_no = match_no;
    t.player = ctx.accounts.player.key();
    t.payout = payout;
    t.amount = amount;
    t.expires_at = now.saturating_add(TICKET_TTL_SECS);
    t.consumed = false;

    if !same_table {
        // the stake follows the ticket to its new table's bank
        let from_ai = ctx.accounts.from_bank.to_account_info();
        let left = from_ai.lamports().checked_sub(amount).ok_or(BlackoutError::BadAccount)?;
        **from_ai.try_borrow_mut_lamports()? = left;
        let to_bank = ctx.accounts.to_bank.as_mut().ok_or(BlackoutError::BadAccount)?;
        let to_ai = to_bank.to_account_info();
        let total = to_ai.lamports().checked_add(amount).ok_or(BlackoutError::BadAccount)?;
        **to_ai.try_borrow_mut_lamports()? = total;
        to_bank.outstanding = to_bank.outstanding.checked_add(amount).ok_or(BlackoutError::BadAccount)?;
        to_bank.tickets = to_bank.tickets.checked_add(1).ok_or(BlackoutError::BadAccount)?;
        let from = &mut ctx.accounts.from_bank;
        from.outstanding = from.outstanding.checked_sub(amount).ok_or(BlackoutError::BadAccount)?;
        from.tickets = from.tickets.saturating_sub(1);
    }
    // same table: one ticket closes (rent back to the player), one opens; the bank's counts stand
    Ok(())
}

/// Magic Action: runs on Solana right after the ER commits a finished staked
/// night. The pot is exactly the tickets it uses up, which is what makes refunds
/// safe: any ticket still unused once its match has settled was never in that match.
pub fn handle_settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
    // Only the delegation program can sign for the room's escrow PDA, which
    // restricts settle to the post-commit Magic Action path.
    let expected_escrow = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&ctx.accounts.room.key(), ACTION_ESCROW_INDEX);
    // The executor appends [program, escrow_auth, escrow] after the action accounts, so
    // the two named escrow fields really hold tickets; scan everything past `winner`.
    let extras = || {
        [ctx.accounts.escrow_auth.as_ref(), ctx.accounts.escrow.as_ref()]
            .into_iter()
            .chain(ctx.remaining_accounts.iter())
    };
    require!(extras().any(|a| a.key() == expected_escrow && a.is_signer), BlackoutError::BadAccount);
    let room: Room = {
        let data = ctx.accounts.room.try_borrow_data()?;
        require!(data.len() >= 8 + core::mem::size_of::<Room>(), BlackoutError::BadAccount);
        *bytemuck::from_bytes::<Room>(&data[8..8 + core::mem::size_of::<Room>()])
    };
    let bank = &mut ctx.accounts.bank;
    require!(bank.room_id == room.room_id, BlackoutError::BadAccount);
    if room.stake == 0 || room.status != ST_REVEALED || room.match_no <= bank.paid_match {
        return Ok(());
    }
    bank.paid_match = room.match_no;

    let w = room.winner as usize;
    let has_winner = w < MAXP && room.is_bot[w] == 0;
    let mut pot = 0u64;
    let mut fee = 0u64;
    if has_winner {
        require_keys_eq!(ctx.accounts.winner.key(), room.payout[w], BlackoutError::BadAccount);
        for ai in extras() {
            pot = pot.saturating_add(use_ticket(ai, &room)?);
        }
        ctx.accounts.bank.outstanding = ctx.accounts.bank.outstanding.saturating_sub(pot);
        let bank_ai = ctx.accounts.bank.to_account_info();
        let rent = Rent::get()?.minimum_balance(bank_ai.data_len());
        pot = pot.min(bank_ai.lamports().saturating_sub(rent));
        if pot > 0 {
            let treasury = ctx.accounts.treasury.to_account_info();
            let min_balance = Rent::get()?.minimum_balance(0);
            fee = house_fee(pot, treasury.lamports(), min_balance);
            **bank_ai.try_borrow_mut_lamports()? -= pot;
            let total = treasury.lamports().checked_add(fee).ok_or(BlackoutError::BadAccount)?;
            **treasury.try_borrow_mut_lamports()? = total;
            let winner = ctx.accounts.winner.to_account_info();
            let total = winner.lamports().checked_add(pot - fee).ok_or(BlackoutError::BadAccount)?;
            **winner.try_borrow_mut_lamports()? = total;
        }
    }

    let mut board = ctx.accounts.board.load_mut()?;
    board.matches = board.matches.saturating_add(1);
    for s in 0..MAXP {
        // Only real, wallet-linked humans make the board.
        if room.is_bot[s] == 1 || room.players[s] == Pubkey::default() || room.payout[s] == room.players[s] || room.payout[s] == Pubkey::default() {
            continue;
        }
        let key = room.payout[s];
        let won = has_winner && w == s;
        let n = board.count as usize;
        let fresh = BoardEntry { key, name: [0; 16], wins: 0, kills: 0, games: 0, best_place: 99, earned: 0 };
        let idx = match board.entries[..n].iter().position(|e| e.key == key) {
            Some(i) => Some(i),
            None if n < BOARD_SLOTS => {
                board.entries[n] = fresh;
                board.count += 1;
                Some(n)
            }
            None if won => {
                let i = board.entries.iter().enumerate().min_by_key(|(_, e)| (e.wins, e.kills)).map_or(0, |(i, _)| i);
                board.entries[i] = fresh;
                Some(i)
            }
            None => None,
        };
        if let Some(i) = idx {
            let e = &mut board.entries[i];
            e.name = room.names[s];
            e.games = e.games.saturating_add(1);
            e.kills = e.kills.saturating_add(room.kills[s]);
            if won {
                e.wins = e.wins.saturating_add(1);
                e.earned = e.earned.saturating_add(pot - fee);
            }
            if room.place[s] > 0 && room.place[s] < e.best_place {
                e.best_place = room.place[s];
            }
        }
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(room_id: u64, match_no: u32)]
pub struct BuyTicket<'info> {
    /// CHECK: room PDA (delegated: owned by the delegation program on base)
    #[account(seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    #[account(mut, seeds = [BANK_SEED, &room_id.to_le_bytes()], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    #[account(
        init,
        payer = player,
        space = TICKET_LEN,
        seeds = [TICKET_SEED, &room_id.to_le_bytes(), &match_no.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseTicket<'info> {
    #[account(
        mut,
        close = payout,
        has_one = payout,
        seeds = [TICKET_SEED, &ticket.room_id.to_le_bytes(), &ticket.match_no.to_le_bytes(), ticket.player.as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(mut, seeds = [BANK_SEED, &ticket.room_id.to_le_bytes()], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    /// CHECK: the ticket's own payout wallet (has_one)
    #[account(mut)]
    pub payout: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(room_id: u64, match_no: u32)]
pub struct ReuseTicket<'info> {
    /// the unused ticket; closed, its rent back to the player who paid it
    #[account(
        mut,
        close = player,
        has_one = player,
        seeds = [TICKET_SEED, &old_ticket.room_id.to_le_bytes(), &old_ticket.match_no.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub old_ticket: Account<'info, Ticket>,
    #[account(mut, seeds = [BANK_SEED, &old_ticket.room_id.to_le_bytes()], bump = from_bank.bump)]
    pub from_bank: Account<'info, Bank>,
    /// CHECK: the new table's room PDA (delegated: owned by the delegation program on base); read for its stake
    #[account(seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    /// the new table's bank; None when it's the same table
    #[account(mut, seeds = [BANK_SEED, &room_id.to_le_bytes()], bump)]
    pub to_bank: Option<Account<'info, Bank>>,
    #[account(
        init,
        payer = player,
        space = TICKET_LEN,
        seeds = [TICKET_SEED, &room_id.to_le_bytes(), &match_no.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub new_ticket: Account<'info, Ticket>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[action]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut)]
    pub bank: Account<'info, Bank>,
    /// CHECK: room as committed by the ER; must be the bank's room PDA
    #[account(seeds = [ROOM_SEED, &bank.room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    /// CHECK: verified against room.payout[winner]
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: the fixed fee wallet
    #[account(mut, address = TREASURY)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: escrow authority / escrow pair, verified in the handler (order-agnostic)
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: see above
    pub escrow: UncheckedAccount<'info>,
}

/// The fee on a pot. Zero if paying it would leave the treasury below rent exemption:
/// the runtime would reject that, and the fee must never be able to block a winner's payout.
pub fn house_fee(pot: u64, treasury_balance: u64, min_balance: u64) -> u64 {
    let fee = (pot as u128 * FEE_BPS as u128 / 10_000) as u64;
    if treasury_balance.saturating_add(fee) < min_balance {
        0
    } else {
        fee
    }
}

/// Mark one of the tickets settle was handed as used. Returns its stake, or 0 for anything
/// that isn't an unused ticket for this match (the escrow accounts, or a refunded ticket).
pub fn use_ticket(ai: &AccountInfo, room: &Room) -> Result<u64> {
    if *ai.owner != crate::ID || !ai.is_writable || ai.data_len() != TICKET_LEN {
        return Ok(0);
    }
    let mut data = ai.try_borrow_mut_data()?;
    let t = Ticket::try_deserialize(&mut &data[..])?;
    if t.consumed || t.room_id != room.room_id || t.match_no != room.match_no || room.seat_of(&t.player).is_none() {
        return Ok(0);
    }
    data[TICKET_LEN - 1] = 1; // `consumed` is the last field
    Ok(t.amount)
}

#[cfg(test)]
#[cfg(test)]
mod fee_tests {
    use super::*;

    #[test]
    fn fee_is_five_percent_and_never_exceeds_the_pot() {
        assert_eq!(house_fee(80_000_000, 1_000_000_000, 890_880), 4_000_000);
        assert_eq!(house_fee(20_000_000, 1_000_000_000, 890_880), 1_000_000);
        assert_eq!(house_fee(19, 1_000_000_000, 890_880), 0); // rounds down
        assert!(house_fee(u64::MAX, u64::MAX, 890_880) < u64::MAX);
    }

    #[test]
    fn an_empty_treasury_never_blocks_the_payout() {
        assert_eq!(house_fee(4_000_000, 0, 890_880), 0); // too little to open a wallet
        assert_eq!(house_fee(20_000_000, 0, 890_880), 1_000_000); // 0.001 SOL can
    }
}
