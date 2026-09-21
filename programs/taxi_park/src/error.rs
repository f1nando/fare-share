use anchor_lang::prelude::*;

#[error_code]
pub enum TaxiError {
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Protocol is already paused")]
    AlreadyPaused,
    #[msg("Protocol is not paused")]
    NotPaused,
    #[msg("Sale has already started")]
    SaleAlreadyStarted,
    #[msg("Mint price must be greater than zero")]
    InvalidPrice,
    #[msg("Admin address cannot be the zero address")]
    InvalidAdmin,
    #[msg("Unknown machine class")]
    InvalidClass,
    #[msg("Event queue is full")]
    QueueFull,
    #[msg("Event queue is empty")]
    QueueEmpty,
    #[msg("Event order is invalid")]
    InvalidEventOrder,
    #[msg("Reward series is already active")]
    SeriesAlreadyActive,
    #[msg("Reward series is not active")]
    SeriesNotActive,
    #[msg("Reward segment is outside the active series")]
    InvalidSegment,
    #[msg("Active weight is inconsistent")]
    InvalidActiveWeight,
    #[msg("Machine event does not match the machine")]
    InvalidMachineEvent,
    #[msg("Batch limit must be between 1 and 20")]
    InvalidBatchLimit,
    #[msg("Required machine PDA was not supplied")]
    MissingMachineAccount,
    #[msg("Machine PDA must be writable")]
    MachineAccountNotWritable,
    #[msg("Team recipient does not match configuration")]
    InvalidTeamAccount,
    #[msg("Fee vault balance is lower than its recorded reserves")]
    VaultBalanceMismatch,
    #[msg("There are no new creator fees to collect")]
    NothingToCollect,
    #[msg("Queue page index is invalid")]
    InvalidQueuePage,
    #[msg("Required event page PDA was not supplied")]
    MissingEventPage,
    #[msg("Event page PDA must be writable")]
    EventPageNotWritable,
    #[msg("Queue page cursor does not match page contents")]
    QueueCursorMismatch,
    #[msg("Reward asset index must be between 0 and 4")]
    InvalidRewardAsset,
    #[msg("Reward mint does not match configuration")]
    InvalidRewardMint,
    #[msg("Token vault contains no new reward tokens")]
    NothingToSync,
}
