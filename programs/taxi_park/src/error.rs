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
    #[msg("Machine expiry event is still required for reward accounting")]
    EventNotStale,
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
    #[msg("Metadata URI is empty or too long")]
    InvalidMetadataUri,
    #[msg("NFT does not belong to the configured collection")]
    InvalidCollection,
    #[msg("Signer is not the current NFT owner")]
    InvalidAssetOwner,
    #[msg("Machine is permanently closed")]
    MachineClosed,
    #[msg("Machine already has full durability")]
    NothingToRepair,
    #[msg("Machine class supply is exhausted")]
    ClassSoldOut,
    #[msg("NFT sale has not started")]
    SaleNotStarted,
    #[msg("Event page needs two free slots")]
    EventPageCapacity,
    #[msg("Claim requires five mint/vault/destination/token-program groups")]
    InvalidClaimAccounts,
    #[msg("Unsupported or mismatched SPL Token Program")]
    InvalidTokenProgram,
    #[msg("Token account mint or authority is invalid")]
    InvalidTokenAccount,
    #[msg("Backend signer cannot be the zero address")]
    InvalidBackendSigner,
    #[msg("Jupiter program cannot be the zero address")]
    InvalidJupiterProgram,
    #[msg("Rescue amount is zero or exceeds the vault balance")]
    InvalidRescueAmount,
    #[msg("The Metaplex Core asset still exists and has not been burned")]
    AssetNotBurned,
    #[msg("Trainee duration must be between one hour and seven days")]
    InvalidTraineeDuration,
    #[msg("Trainee voucher has expired")]
    VoucherExpired,
    #[msg("Trainee voucher timestamps are invalid")]
    InvalidTraineeTimes,
    #[msg("Trainee voucher signature is missing or invalid")]
    InvalidVoucherSignature,
    #[msg("Trainee bucket does not match the expected minute")]
    InvalidTraineeBucket,
    #[msg("Trainee bucket has already been processed")]
    TraineeBucketProcessed,
    #[msg("Trainee rewards have not been calculated up to the required time")]
    TraineeRewardsNotCalculated,
    #[msg("Swap plan kind or asset index is invalid")]
    InvalidSwapPlan,
    #[msg("Swap plan nonce is not current")]
    InvalidSwapNonce,
    #[msg("Swap plan has expired")]
    SwapPlanExpired,
    #[msg("Swap route does not match the backend-signed route")]
    InvalidSwapRoute,
    #[msg("Swap route is missing a required source or destination account")]
    MissingSwapAccount,
    #[msg("Swap input amount did not match the signed plan")]
    InvalidSwapInput,
    #[msg("Swap output is below the signed minimum")]
    InsufficientSwapOutput,
}
