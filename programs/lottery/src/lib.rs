use anchor_lang::prelude::*;
use switchboard_on_demand::accounts::RandomnessAccountData;
use anchor_lang::system_program;

declare_id!("GHZdzKPkWc7pnDaA2GSTfgnXmbmnfQy6jLWq6AwrSMY3");

pub const LOTTERY_SEED: &[u8] = b"lottery";
pub const MAX_PARTICIPANTS: u32 = 100;
pub const LOTTERY_PREFIX: &[u8] = b"lottery";

#[program]
pub mod lottery {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, lottery_id: String, entry_fee: u64, end_time: i64) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;
        lottery.lottery_id = lottery_id;
        lottery.admin = ctx.accounts.admin.key();
        lottery.entry_fee = entry_fee;
        lottery.end_time = end_time;
        lottery.total_tickets = 0;
        lottery.winner = None;
        lottery.index = 0;  // Track the current index for participants
        lottery.randomness_account = None;  // Add a randomness account for the lottery
        lottery.participants.clear();  // Ensure the participants vector is cleared
        msg!("Lottery {} Initialized!", lottery.lottery_id);
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
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

        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.lottery.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, entry_fee)?;

        // Store the player's index using the lottery's current index
        let lottery = &mut ctx.accounts.lottery;
        lottery.participants.push(ctx.accounts.player.key()); // Use a vector for fixed participants

        // Increment ticket count and index for next participant
        lottery.total_tickets += 1;
        lottery.index += 1;

        msg!("Ticket purchased by: {:?}", ctx.accounts.player.key());
        Ok(())
    }

    pub fn select_winner(ctx: Context<SelectWinner>) -> Result<()> {
        let lottery = &mut ctx.accounts.lottery;

        // 1. Verify lottery has ended and no winner selected yet
        require!(
            Clock::get().unwrap().unix_timestamp > lottery.end_time,
            LotteryError::LotteryNotEnded
        );
        require!(lottery.winner.is_none(), LotteryError::WinnerAlreadySelected);
        
        // 2. Verify there are participants
        require!(
            lottery.total_tickets > 0 && !lottery.participants.is_empty(),
            LotteryError::NoParticipants
        );

        // 3. Get randomness from Switchboard
        let randomness_data = RandomnessAccountData::parse(
            ctx.accounts.randomness_account_data.data.borrow()
        ).map_err(|_| LotteryError::RandomnessUnavailable)?;

        let clock = Clock::get()?;
        let randomness_result = randomness_data
            .get_value(&clock)
            .map_err(|_| LotteryError::RandomnessNotResolved)?;

        // 4. Guarantee winner selection
        let winner_index = (randomness_result[0] as usize) % lottery.total_tickets as usize;
        
        // Safety check - ensure index is valid
        require!(
            winner_index < lottery.participants.len(),
            LotteryError::InvalidWinnerIndex
        );

        // 5. Set the winner - this cannot fail now
        let winner_pubkey = lottery.participants[winner_index];
        lottery.winner = Some(winner_pubkey);

        msg!("Winner selected: {:?}", winner_pubkey);
        msg!("Winner index: {}", winner_index);
        msg!("Total participants: {}", lottery.total_tickets);

        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        require!(
            Some(ctx.accounts.player.key()) == ctx.accounts.lottery.winner,
            LotteryError::NotWinner
        );

        let total_collected = ctx.accounts.lottery.entry_fee
            .checked_mul(ctx.accounts.lottery.total_tickets as u64)
            .ok_or(LotteryError::Overflow)?;
        
        let prize_amount = total_collected
            .checked_mul(90)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Developer gets 10% of the total pool
        let developer_share = total_collected
            .checked_mul(10)
            .ok_or(LotteryError::Overflow)?
            .checked_div(100)
            .ok_or(LotteryError::Overflow)?;

        // Transfer developer's share
        **ctx.accounts.lottery.to_account_info().try_borrow_mut_lamports()? -= developer_share;
        **ctx.accounts.developer.to_account_info().try_borrow_mut_lamports()? += developer_share;

        // Transfer prize to the winner (90% of the pool)
        **ctx.accounts.lottery.to_account_info().try_borrow_mut_lamports()? -= prize_amount;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += prize_amount;

        // Reset lottery state after prize claim
        let lottery = &mut ctx.accounts.lottery;
        lottery.total_tickets = 0;
        lottery.participants.clear();  // Clear participants list
        lottery.index = 0;  // Reset participant index
        lottery.winner = None;

        msg!("Prize of {} lamports claimed by: {:?}", prize_amount, ctx.accounts.player.key());
        msg!("Developer share of {} lamports transferred.", developer_share);
        msg!("Lottery has been reset for the next round");
        Ok(())
    }

    pub fn close_lottery(ctx: Context<CloseLottery>) -> Result<()> {
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
#[account]
pub struct LotteryState {
    pub lottery_id: String,
    pub admin: Pubkey,
    pub entry_fee: u64,
    pub total_tickets: u32,
    pub participants: Vec<Pubkey>,  // Use a vector for fixed participants
    pub end_time: i64,
    pub winner: Option<Pubkey>,
    pub randomness_account: Option<Pubkey>, // Added to store randomness account
    pub index: u32,  // Track the next index to use for participants
}

impl LotteryState {
    const LEN: usize = 4 + 32 + 32 + 8 + 4 + (4 * MAX_PARTICIPANTS as usize) + 8 + 1 + 32 + 1 + 32 + 4; // Adjusted for vector of participants
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
    #[account(mut)]
    pub developer: Signer<'info>, // Account for the developer's share
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
}
