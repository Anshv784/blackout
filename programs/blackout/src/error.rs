use anchor_lang::prelude::*;

#[error_code]
pub enum BlackoutError {
    #[msg("Bad account")]
    BadAccount,
    #[msg("Bad seat")]
    BadSeat,
    #[msg("Room is not in the lobby")]
    NotInLobby,
    #[msg("Wrong room code")]
    WrongCode,
    #[msg("Already seated")]
    AlreadySeated,
    #[msg("Seat taken")]
    SeatTaken,
    #[msg("This room needs a ticket")]
    NeedTicket,
    #[msg("Room is not staked")]
    NotStaked,
    #[msg("Not seated in this room")]
    NotSeated,
    #[msg("Only the host can start")]
    NotHost,
    #[msg("Need at least 2 players")]
    NotEnoughPlayers,
    #[msg("Match is not waiting for a seed")]
    NotStarting,
    #[msg("Too early")]
    TooEarly,
    #[msg("Match has not ended")]
    NotEnded,
    #[msg("Room setup is not finished")]
    NotReady,
    #[msg("Someone is already using this room")]
    RoomTaken,
    #[msg("Room is full")]
    RoomFull,
    #[msg("This room has no host — create your own")]
    NoHost,
    #[msg("Admin only")]
    NotAdmin,
    #[msg("This ticket can't be refunded yet")]
    TicketLocked,
    #[msg("Tickets for this room still exist: run scripts/sweep_tickets.ts first")]
    StakesOutstanding,
}
