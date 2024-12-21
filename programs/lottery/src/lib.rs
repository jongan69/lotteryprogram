use anchor_lang::prelude::*;
use switchboard_on_demand::accounts::RandomnessAccountData;
use anchor_lang::system_program;

declare_id!("47dK2oPBoGLs5icFYVqEgbkF31TbkFSSbtvToEK3Fn5J");

pub const LOTTERY_SEED: &[u8] = b"lottery";
pub const MAX_PARTICIPANTS: u32 = 100;
pub const LOTTERY_PREFIX: &[u8] = b"lottery";

#[program]
pub mod lottery {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, lottery_id: String, entry_fee: u64, end_time: i64, creator_key: Pubkey) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;
        lottery.lottery_id = lottery_id;
        lottery.admin = ctx.accounts.admin.key();
        lottery.creator = creator_key;
        lottery.entry_fee = entry_fee;
        lottery.end_time = end_time;
        lottery.total_tickets = 0;
        lottery.winner = None;
        lottery.index = 0;
        lottery.randomness_account = None;
        lottery.participants.clear();
        lottery.status = LotteryStatus::Active;
        lottery.total_prize = 0;
        msg!("Lottery {} Initialized!", lottery.lottery_id);
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>, lottery_id: String) -> Result<()> {
        require!(
            ctx.accounts.lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );
        require!(
            ctx.accounts.player.key() != ctx.accounts.lottery.creator,
            LotteryError::CreatorCannotParticipate
        );
        require!(
            Clock::get().unwrap().unix_timestamp <= ctx.accounts.lottery.end_time,
            LotteryError::LotteryClosed
        );
        require!(
            ctx.accounts.lottery.winner.is_none(),
            LotteryError::WinnerAlreadySelected
        );
        require!(
            ctx.accounts.lottery.total_tickets < MAX_PARTICIPANTS,
            LotteryError::MaxParticipantsReached
        );

        let entry_fee = ctx.accounts.lottery.entry_fee;
        msg!(
            "Player balance before purchase: {} lamports",
            ctx.accounts.player.lamports()
        );
        
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.lottery.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, entry_fee)?;

        msg!(
            "Player balance after purchase: {} lamports",
            ctx.accounts.player.lamports()
        );
        msg!(
            "Lottery pool balance: {} lamports",
            ctx.accounts.lottery.to_account_info().lamports()
        );
        
        // Store the player's index using the lottery's current index
        let lottery = &mut ctx.accounts.lottery;
        lottery.participants.push(ctx.accounts.player.key()); // Use a vector for fixed participants

        // Increment ticket count and index for next participant
        lottery.total_tickets += 1;
        lottery.index += 1;

        msg!("Ticket purchased by: {:?}", ctx.accounts.player.key());
        Ok(())
    }

    pub fn select_winner(ctx: Context<SelectWinner>, lottery_id: String) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;
        
        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );
        msg!("Lottery ID verified");

        // Calculate total prize before selecting winner
        lottery.total_prize = lottery.entry_fee
            .checked_mul(lottery.total_tickets as u64)
            .ok_or(LotteryError::Overflow)?;

        // 1. Verify lottery has ended
        let current_time = Clock::get().unwrap().unix_timestamp;
        msg!("Current time: {}, End time: {}", current_time, lottery.end_time);
        require!(
            current_time > lottery.end_time,
            LotteryError::LotteryNotEnded
        );
        msg!("Lottery end time verified");

        // 2. Check winner status
        require!(lottery.winner.is_none(), LotteryError::WinnerAlreadySelected);
        msg!("No winner previously selected");
        
        // 3. Check participants
        msg!("Total tickets: {}, Participants: {}", lottery.total_tickets, lottery.participants.len());
        require!(
            lottery.total_tickets > 0 && !lottery.participants.is_empty(),
            LotteryError::NoParticipants
        );

        // 4. Get randomness
        msg!("Attempting to parse randomness data...");
        let randomness_data = RandomnessAccountData::parse(
            ctx.accounts.randomness_account_data.data.borrow()
        ).map_err(|_| {
            msg!("Failed to parse randomness data");
            LotteryError::RandomnessUnavailable
        })?;
        msg!("Randomness data parsed successfully");

        msg!("Attempting to get randomness value...");
        let clock = Clock::get()?;
        let randomness_result = randomness_data
            .get_value(&clock)
            .map_err(|_| {
                msg!("Randomness not yet resolved");
                LotteryError::RandomnessNotResolved
            })?;
        msg!("Got randomness value");

        // 5. Select winner
        let winner_index = (randomness_result[0] as usize) % lottery.total_tickets as usize;
        msg!("Calculated winner index: {}", winner_index);
        
        require!(
            winner_index < lottery.participants.len(),
            LotteryError::InvalidWinnerIndex
        );

        let winner_pubkey = lottery.participants[winner_index];
        lottery.winner = Some(winner_pubkey);
        lottery.status = LotteryStatus::WinnerSelected;

        msg!("Winner successfully selected: {:?}", winner_pubkey);
        msg!("Total prize pool: {} lamports", lottery.total_prize);
        msg!("Winner index: {}", winner_index);
        msg!("Total participants: {}", lottery.total_tickets);

        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>, lottery_id: String) -> Result<()> {
        let lottery_info = ctx.accounts.lottery.to_account_info();
        let lottery = &mut ctx.accounts.lottery;
        
        require!(
            lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );
        
        require!(
            Some(ctx.accounts.player.key()) == lottery.winner,
            LotteryError::NotWinner
        );

        let total_collected = lottery.total_prize;
        
        // Winner gets 85% of the pool
        let prize_amount = total_collected
            .checked_mul(85)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Creator gets 5% of the pool
        let creator_share = total_collected
            .checked_mul(5)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Developer gets 10% of the pool
        let developer_share = total_collected
            .checked_mul(10)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Transfer creator's share
        **lottery_info.try_borrow_mut_lamports()? -= creator_share;
        **ctx.accounts.creator.try_borrow_mut_lamports()? += creator_share;

        // Transfer developer's share
        **lottery_info.try_borrow_mut_lamports()? -= developer_share;
        **ctx.accounts.developer.to_account_info().try_borrow_mut_lamports()? += developer_share;

        // Transfer prize to the winner
        **lottery_info.try_borrow_mut_lamports()? -= prize_amount;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += prize_amount;

        // Reset lottery state after prize claim
        lottery.total_tickets = 0;
        lottery.participants.clear();
        lottery.index = 0;
        lottery.winner = None;
        lottery.status = LotteryStatus::Completed;
        lottery.total_prize = 0;

        msg!(
            "Final balances - Winner: {} lamports, Creator: {} lamports, Developer: {} lamports, Pool: {} lamports",
            ctx.accounts.player.lamports(),
            ctx.accounts.creator.lamports(),
            ctx.accounts.developer.lamports(),
            ctx.accounts.lottery.to_account_info().lamports()
        );
        msg!("Prize of {} lamports claimed by: {:?}", prize_amount, ctx.accounts.player.key());
        msg!("Creator share of {} lamports transferred.", creator_share);
        msg!("Developer share of {} lamports transferred.", developer_share);
        msg!("Lottery has been reset for the next round");
        Ok(())
    }

    pub fn close_lottery(ctx: Context<CloseLottery>, lottery_id: String) -> Result<()> {
        // Verify this is the lottery we want to close
        require!(
            ctx.accounts.lottery.lottery_id == lottery_id,
            LotteryError::InvalidLotteryId
        );

        // Transfer remaining lamports to admin
        let dest_starting_lamports = ctx.accounts.admin.lamports();
        let lottery_lamports = ctx.accounts.lottery.to_account_info().lamports();
        
        **ctx.accounts.lottery.to_account_info().try_borrow_mut_lamports()? = 0;
        **ctx.accounts.admin.try_borrow_mut_lamports()? = dest_starting_lamports
            .checked_add(lottery_lamports)
            .ok_or(LotteryError::Overflow)?;

        Ok(())
    }
}

// === LotteryState Struct Definition ===
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Debug)]
pub enum LotteryStatus {
    Active,
    EndedWaitingForWinner,
    WinnerSelected,
    Completed,
}

#[account]
pub struct LotteryState {
    pub lottery_id: String,
    pub admin: Pubkey,
    pub creator: Pubkey,
    pub entry_fee: u64,
    pub total_tickets: u32,
    pub participants: Vec<Pubkey>,
    pub end_time: i64,
    pub winner: Option<Pubkey>,
    pub randomness_account: Option<Pubkey>,
    pub index: u32,
    pub status: LotteryStatus,
    pub total_prize: u64,
}

impl LotteryState {
    const LEN: usize = 4 + 32 + 32 + 32 + 8 + 4 + (4 * MAX_PARTICIPANTS as usize) + 8 + 1 + 32 + 1 + 32 + 4 + 1 + 8;
}

// === Context Structs ===
#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        seeds = [
            LOTTERY_PREFIX,
            lottery_id.as_bytes(),
        ],
        space = 8 + LotteryState::LEN,
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct SelectWinner<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump
    )]
    pub lottery: Account<'info, LotteryState>,
    /// CHECK: This account is validated manually within the handler.
    pub randomness_account_data: AccountInfo<'info>,  // Use Switchboard randomness
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct ClaimPrize<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump,
        constraint = lottery.winner.is_some() @ LotteryError::NoWinnerSelected,
        constraint = lottery.winner.unwrap() == player.key() @ LotteryError::NotWinner,
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: Creator account that receives 5% of the prize
    #[account(mut, constraint = lottery.creator == creator.key())]
    pub creator: AccountInfo<'info>,
    #[account(mut)]
    pub developer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(lottery_id: String)]
pub struct CloseLottery<'info> {
    #[account(
        mut,
        seeds = [LOTTERY_PREFIX, lottery_id.as_bytes()],
        bump,
        close = admin
    )]
    pub lottery: Account<'info, LotteryState>,
    #[account(
        mut,
        constraint = lottery.admin == admin.key()
    )]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// === Errors ===
#[error_code]
pub enum LotteryError {
    #[msg("The lottery has already ended.")]
    LotteryClosed,
    #[msg("The lottery has not ended yet.")]
    LotteryNotEnded,
    #[msg("A winner has already been selected.")]
    WinnerAlreadySelected,
    #[msg("You are not the winner.")]
    NotWinner,
    #[msg("Arithmetic overflow occurred.")]
    Overflow,
    #[msg("No participants in the lottery.")]
    NoParticipants,
    #[msg("Maximum participants reached.")]
    MaxParticipantsReached,
    #[msg("No winner selected.")]
    NoWinnerSelected,
    #[msg("Randomness data is unavailable.")]
    RandomnessUnavailable,
    #[msg("Randomness not resolved.")]
    RandomnessNotResolved,
    #[msg("Invalid winner index.")]
    InvalidWinnerIndex,
    #[msg("Invalid lottery ID")]
    InvalidLotteryId,
    #[msg("Lottery creator cannot participate in their own lottery")]
    CreatorCannotParticipate,
}
