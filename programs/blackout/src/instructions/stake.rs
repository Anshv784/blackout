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
    // ...and so would any account that can't take SOL (a program, a sysvar): the winnings wallet
    // must be an ordinary wallet, owned by the System Program and not executable
    let pw = &ctx.accounts.payout_wallet;
    require_keys_eq!(pw.key(), payout, BlackoutError::BadAccount);
    require!(*pw.owner == anchor_lang::system_program::ID && !pw.executable, BlackoutError::BadAccount);
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
        // free to move once its night has paid out without it, or a day after it expired (a night
        // that never paid out, e.g. the rollup stopped); never while a payout may still be coming
        require!(
            old.match_no <= ctx.accounts.from_bank.paid_match || now > old.expires_at.saturating_add(TICKET_RELEASE_GRACE_SECS),
            BlackoutError::TicketLocked
        );
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
    // a winner whose wallet has since become a program can't be paid (the transfer would fail and
    // block the whole settle): the night then counts as having no winner, so nothing is stuck and
    // every seated ticket carries over
    let has_winner = w < MAXP && room.is_bot[w] == 0 && !ctx.accounts.winner.executable;
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
            // a prize table: 2% of the pot (out of the 5% fee) goes to the day's prize
            let prize_ai = ctx.accounts.prize.to_account_info();
            let cut = if room.stake == PRIZE_STAKE { prize_cut(pot, fee) } else { 0 };
            let cut = if cut > 0 { add_to_prize(&prize_ai, &treasury, cut)? } else { 0 };
            // the table fund keeps the tables' MagicBlock wallets topped up (see `refill_table`)
            let fund_ai = ctx.accounts.fund.to_account_info();
            let fund_cut = table_fund_cut(fee - cut, fund_ai.lamports(), min_balance);
            if fund_cut > 0 {
                let total = fund_ai.lamports().checked_add(fund_cut).ok_or(BlackoutError::BadAccount)?;
                **fund_ai.try_borrow_mut_lamports()? = total;
            }
            **bank_ai.try_borrow_mut_lamports()? -= pot;
            let total = treasury.lamports().checked_add(fee - cut - fund_cut).ok_or(BlackoutError::BadAccount)?;
            **treasury.try_borrow_mut_lamports()? = total;
            let winner = ctx.accounts.winner.to_account_info();
            let total = winner.lamports().checked_add(pot - fee).ok_or(BlackoutError::BadAccount)?;
            **winner.try_borrow_mut_lamports()? = total;
            if room.stake == PRIZE_STAKE {
                record_prize_night(&prize_ai, &treasury, &room, w, pot - fee)?;
            }
        }
    }

    // a permanent record of this staked night in the transaction log, for the fair-play report
    // (scripts/fairplay.ts): who sat where, who killed whom, the winner
    emit!(night_record(&room, pot));

    let mut board = ctx.accounts.board.load_mut()?;
    board.matches = board.matches.saturating_add(1);
    for s in 0..MAXP {
        // Only real, wallet-linked humans make the board.
        if room.is_bot[s] == 1 || room.players[s] == Pubkey::default() || room.payout[s] == room.players[s] || room.payout[s] == Pubkey::default() {
            continue;
        }
        let key = room.payout[s];
        let won = has_winner && w == s;
        let n = (board.count as usize).min(BOARD_SLOTS);
        let fresh = BoardEntry { key, name: [0; 16], wins: 0, kills: 0, games: 0, best_place: 99, earned: 0 };
        let idx = match board.entries[..n].iter().position(|e| e.key == key) {
            Some(i) => Some(i),
            None if n < BOARD_SLOTS => {
                board.entries[n] = fresh;
                board.count += 1;
                Some(n)
            }
            None if won => {
                board.count = BOARD_SLOTS as u32;
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
    /// CHECK: the winnings wallet named by `payout`; checked in the handler (an ordinary wallet)
    pub payout_wallet: UncheckedAccount<'info>,
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

/// The prize's share of a pot: PRIZE_BPS of it, never more than the fee it comes out of.
pub fn prize_cut(pot: u64, fee: u64) -> u64 {
    ((pot as u128 * PRIZE_BPS as u128 / 10_000) as u64).min(fee)
}

/// Run `f` on the prize account if it has been created (settle works without it: the whole fee
/// then goes to the treasury). Closes yesterday first if a new UTC day has started, sending what
/// that frees to the treasury.
fn with_prize<R>(prize_ai: &AccountInfo, treasury_ai: &AccountInfo, f: impl FnOnce(&mut Prize) -> R) -> Result<Option<R>> {
    if prize_ai.owner != &crate::ID || prize_ai.data_len() < 8 + core::mem::size_of::<Prize>() {
        return Ok(None);
    }
    let today = (Clock::get()?.unix_timestamp / 86_400) as u32;
    let (to_treasury, out) = {
        let mut data = prize_ai.try_borrow_mut_data()?;
        require!(data[..8] == *<Prize as anchor_lang::Discriminator>::DISCRIMINATOR, BlackoutError::BadAccount);
        let p: &mut Prize = bytemuck::from_bytes_mut(&mut data[8..8 + core::mem::size_of::<Prize>()]);
        let to_treasury = p.roll(today);
        (to_treasury, f(p))
    };
    if to_treasury > 0 {
        move_lamports(prize_ai, treasury_ai, to_treasury)?;
    }
    Ok(Some(out))
}

/// Put `cut` into today's prize. Returns what was actually set aside (0 without a prize account).
fn add_to_prize(prize_ai: &AccountInfo, treasury_ai: &AccountInfo, cut: u64) -> Result<u64> {
    let added = with_prize(prize_ai, treasury_ai, |p| {
        p.pot = p.pot.saturating_add(cut);
    })?;
    if added.is_none() {
        return Ok(0);
    }
    let total = prize_ai.lamports().checked_add(cut).ok_or(BlackoutError::BadAccount)?;
    **prize_ai.try_borrow_mut_lamports()? = total;
    Ok(cut)
}

/// Count this night for every staker at the prize table: a game, their stake, and the winner's take.
fn record_prize_night(prize_ai: &AccountInfo, treasury_ai: &AccountInfo, room: &Room, winner_seat: usize, winnings: u64) -> Result<()> {
    let mut seats: Vec<NightFinish> = Vec::with_capacity(MAXP);
    let mut winner = None;
    for s in 0..MAXP {
        let key = room.payout[s];
        if room.is_bot[s] == 1 || room.players[s] == Pubkey::default() || key == Pubkey::default() {
            continue;
        }
        if s == winner_seat {
            winner = Some(seats.len());
        }
        seats.push(NightFinish { key, place: room.place[s] });
    }
    with_prize(prize_ai, treasury_ai, |p| p.record_night(&seats, room.stake, winner, winnings))?;
    Ok(())
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let left = from.lamports().checked_sub(amount).ok_or(BlackoutError::BadAccount)?;
    **from.try_borrow_mut_lamports()? = left;
    let total = to.lamports().checked_add(amount).ok_or(BlackoutError::BadAccount)?;
    **to.try_borrow_mut_lamports()? = total;
    Ok(())
}

/// The day's winner takes the prize. Closes the day first if it has ended. Signed by the winning
/// payout wallet; the money goes only to it.
/// Pay a winner everything they're owed. Anyone may send it (and pays the network fee); the prize
/// only ever goes to the winner's own wallet. No deadline: a prize waits until it's paid.
pub fn handle_claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
    let today = (Clock::get()?.unix_timestamp / 86_400) as u32;
    let prize_ai = ctx.accounts.prize.to_account_info();
    let winner = ctx.accounts.winner.to_account_info();
    // an ordinary wallet (paying a program would fail); the prize stays owed otherwise
    require!(*winner.owner == anchor_lang::system_program::ID && !winner.executable, BlackoutError::BadAccount);
    let (to_treasury, amount) = {
        let mut p = ctx.accounts.prize.load_mut()?;
        let to_treasury = p.roll(today);
        let amount = p.take_owed(&winner.key());
        require!(amount > 0, BlackoutError::NoPrize);
        if p.last_winner == winner.key() {
            p.last_claimed = 1;
        }
        (to_treasury, amount)
    };
    if to_treasury > 0 {
        move_lamports(&prize_ai, &ctx.accounts.treasury.to_account_info(), to_treasury)?;
    }
    move_lamports(&prize_ai, &winner, amount)
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut, seeds = [PRIZE_SEED], bump)]
    pub prize: AccountLoader<'info, Prize>,
    /// CHECK: the fixed fee wallet (gets a day's pot only if nobody qualified)
    #[account(mut, address = TREASURY)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: the winner being paid; must be on the owed list (checked in the handler)
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
    /// CHECK: the daily prize PDA; used only if it exists (see `live_prize`)
    #[account(mut, seeds = [PRIZE_SEED], bump)]
    pub prize: UncheckedAccount<'info>,
    /// CHECK: the table fund (system-owned PDA, may not exist yet)
    #[account(mut, seeds = [FUND_SEED], bump)]
    pub fund: UncheckedAccount<'info>,
    /// CHECK: escrow authority / escrow pair, verified in the handler (order-agnostic)
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: see above
    pub escrow: UncheckedAccount<'info>,
}

/// One staked night, as logged by settle. Seats are 0-7; `wallets` holds each human seat's payout
/// wallet (default for bots and empty seats). `feed_killer`/`feed_victim` list the kills in order,
/// 255 = the zone.
#[event]
pub struct NightRecord {
    pub room_id: u64,
    pub match_no: u32,
    pub stake: u64,
    pub pot: u64,
    pub winner: u8,
    pub wallets: [Pubkey; MAXP],
    pub kills: [u8; MAXP],
    pub place: [u8; MAXP],
    pub feed_killer: Vec<u8>,
    pub feed_victim: Vec<u8>,
}

pub fn night_record(room: &Room, pot: u64) -> NightRecord {
    let mut wallets = [Pubkey::default(); MAXP];
    let mut kills = [0u8; MAXP];
    let mut place = [0u8; MAXP];
    for s in 0..MAXP {
        if room.is_bot[s] == 0 && room.players[s] != Pubkey::default() {
            wallets[s] = room.payout[s];
        }
        kills[s] = room.kills[s].min(255) as u8;
        place[s] = room.place[s].min(255) as u8;
    }
    let n = (room.feed_head as usize).min(FEED);
    NightRecord {
        room_id: room.room_id,
        match_no: room.match_no,
        stake: room.stake,
        pot,
        winner: room.winner.min(255) as u8,
        wallets,
        kills,
        place,
        feed_killer: room.feed[..n].iter().map(|f| f.killer.min(255) as u8).collect(),
        feed_victim: room.feed[..n].iter().map(|f| f.victim.min(255) as u8).collect(),
    }
}

/// The table fund's share of a night's fee (what's left of it after the prize). Zero if the fund
/// doesn't exist yet and this credit alone wouldn't make it rent-exempt (the runtime would refuse
/// it, and nothing may block a payout).
pub fn table_fund_cut(fee_left: u64, fund_balance: u64, min_balance: u64) -> u64 {
    let cut = TABLE_FUND_PER_NIGHT.min(fee_left);
    if fund_balance.saturating_add(cut) < min_balance {
        0
    } else {
        cut
    }
}

/// Anyone may move TABLE_REFILL from the table fund into a staked table's MagicBlock wallet (the
/// room account inside the rollup, which pays its commits). The fund signs MagicBlock's lamports
/// transfer; MagicBlock's program checks every PDA it is given. The SOL only ever goes to one of
/// this game's staked tables.
pub fn handle_refill_table(ctx: Context<RefillTable>, _room_id: u64, salt: [u8; 32]) -> Result<()> {
    // The fund signs this transfer, and a signature carries into every program it reaches. So every
    // account handed to MagicBlock is derived here, exactly as MagicBlock derives it, and nothing
    // else is accepted: no stand-in account or program can ever be given the fund's signature.
    {
        let a = &ctx.accounts;
        let fund = a.fund.key();
        let room = a.room.key();
        let pda = |seeds: &[&[u8]], program: &Pubkey| Pubkey::find_program_address(seeds, program).0;
        let lamports = pda(&[b"lamports", fund.as_ref(), room.as_ref(), &salt], &ESPL_PROGRAM);
        require_keys_eq!(a.rent_pda.key(), pda(&[b"rent"], &ESPL_PROGRAM), BlackoutError::BadAccount);
        require_keys_eq!(a.lamports_pda.key(), lamports, BlackoutError::BadAccount);
        require_keys_eq!(a.delegate_buffer.key(), pda(&[b"buffer", lamports.as_ref()], &ESPL_PROGRAM), BlackoutError::BadAccount);
        require_keys_eq!(a.delegation_record.key(), pda(&[b"delegation", lamports.as_ref()], &DELEGATION_PROGRAM), BlackoutError::BadAccount);
        require_keys_eq!(a.delegation_metadata.key(), pda(&[b"delegation-metadata", lamports.as_ref()], &DELEGATION_PROGRAM), BlackoutError::BadAccount);
        require_keys_eq!(a.delegation_program.key(), DELEGATION_PROGRAM, BlackoutError::BadAccount);
        require_keys_eq!(a.room_delegation_record.key(), pda(&[b"delegation", room.as_ref()], &DELEGATION_PROGRAM), BlackoutError::BadAccount);
    }
    {
        let data = ctx.accounts.room.try_borrow_data()?;
        require!(data.len() >= 24, BlackoutError::BadAccount);
        let stake = u64::from_le_bytes(data[16..24].try_into().unwrap());
        require!(stake > 0, BlackoutError::NotStaked);
    }
    let fund = ctx.accounts.fund.to_account_info();
    let min = Rent::get()?.minimum_balance(0);
    require!(fund.lamports() >= TABLE_REFILL.saturating_add(TABLE_REFILL_OVERHEAD).saturating_add(min), BlackoutError::NotReady);
    let mut data = Vec::with_capacity(41);
    data.push(20u8);
    data.extend_from_slice(&TABLE_REFILL.to_le_bytes());
    data.extend_from_slice(&salt);
    use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
    let a = &ctx.accounts;
    let ix = Instruction {
        program_id: ESPL_PROGRAM,
        accounts: vec![
            AccountMeta::new(a.fund.key(), true),
            AccountMeta::new(a.rent_pda.key(), false),
            AccountMeta::new(a.lamports_pda.key(), false),
            AccountMeta::new_readonly(ESPL_PROGRAM, false),
            AccountMeta::new(a.delegate_buffer.key(), false),
            AccountMeta::new(a.delegation_record.key(), false),
            AccountMeta::new(a.delegation_metadata.key(), false),
            AccountMeta::new_readonly(a.delegation_program.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
            AccountMeta::new(a.room.key(), false),
            AccountMeta::new_readonly(a.room_delegation_record.key(), false),
        ],
        data,
    };
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            a.fund.to_account_info(),
            a.rent_pda.to_account_info(),
            a.lamports_pda.to_account_info(),
            a.espl_program.to_account_info(),
            a.delegate_buffer.to_account_info(),
            a.delegation_record.to_account_info(),
            a.delegation_metadata.to_account_info(),
            a.delegation_program.to_account_info(),
            a.system_program.to_account_info(),
            a.room.to_account_info(),
            a.room_delegation_record.to_account_info(),
        ],
        &[&[FUND_SEED, &[ctx.bumps.fund]]],
    )?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct RefillTable<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the table fund (system-owned PDA); it signs as the transfer's payer
    #[account(mut, seeds = [FUND_SEED], bump)]
    pub fund: UncheckedAccount<'info>,
    /// CHECK: the staked table (delegated room PDA; its committed copy says it's staked)
    #[account(mut, seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    /// CHECK: MagicBlock's Ephemeral SPL Token program
    #[account(address = ESPL_PROGRAM)]
    pub espl_program: UncheckedAccount<'info>,
    /// CHECK: checked by MagicBlock's program
    #[account(mut)]
    pub rent_pda: UncheckedAccount<'info>,
    /// CHECK: checked by MagicBlock's program
    #[account(mut)]
    pub lamports_pda: UncheckedAccount<'info>,
    /// CHECK: checked by MagicBlock's program
    #[account(mut)]
    pub delegate_buffer: UncheckedAccount<'info>,
    /// CHECK: checked by MagicBlock's program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: checked by MagicBlock's program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock's delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the room's delegation record, checked by MagicBlock's program
    pub room_delegation_record: UncheckedAccount<'info>,
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
    fn the_table_fund_takes_a_thousandth_of_a_sol_per_night() {
        let rent = 890_880;
        // 2 players at the 0.01 table: 0.001 fee, all of it to the fund
        assert_eq!(table_fund_cut(1_000_000, 5_000_000, rent), 1_000_000);
        // 8 at the 0.01 table: 0.004 fee, 0.001 to the fund, the rest kept
        assert_eq!(table_fund_cut(4_000_000, 5_000_000, rent), 1_000_000);
        // 2 at the 0.05 table: 0.005 fee - 0.002 prize = 0.003 left, 0.001 to the fund
        assert_eq!(table_fund_cut(3_000_000, 5_000_000, rent), 1_000_000);
        // never more than what's left of the fee
        assert_eq!(table_fund_cut(400_000, 5_000_000, rent), 400_000);
        // a first credit too small to open the fund is skipped, not allowed to fail the payout
        assert_eq!(table_fund_cut(400_000, 0, rent), 0);
        assert_eq!(table_fund_cut(1_000_000, 0, rent), 1_000_000);
        // no fee, no cut
        assert_eq!(table_fund_cut(0, 5_000_000, rent), 0);
    }

    #[test]
    fn the_prize_takes_two_of_the_five_percent() {
        // a 4-player 0.05 table: 0.2 SOL pot, 0.01 fee, 0.004 to the prize, 0.006 kept
        let pot = 200_000_000;
        let fee = house_fee(pot, 1_000_000_000, 890_880);
        assert_eq!((fee, prize_cut(pot, fee)), (10_000_000, 4_000_000));
        assert_eq!(prize_cut(pot, 0), 0, "no fee (empty treasury): no prize cut either");
    }

    #[test]
    fn an_empty_treasury_never_blocks_the_payout() {
        assert_eq!(house_fee(4_000_000, 0, 890_880), 0); // too little to open a wallet
        assert_eq!(house_fee(20_000_000, 0, 890_880), 1_000_000); // 0.001 SOL can
    }
}
