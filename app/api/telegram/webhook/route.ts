import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Telegraf, Markup } from "telegraf";
import { supabase } from "@/lib/supabase";



const token = process.env.TELEGRAM_BOT_TOKEN;

function communityMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎯 Daily Check-in", "daily_checkin"),
      Markup.button.callback("👤 My Profile", "profile"),
    ],
    [
      Markup.button.callback("📋 Quest Center", "quests"),
      Markup.button.callback("🏆 Leaderboard", "leaderboard"),
    ],
    [
      Markup.button.callback("🎁 Rewards", "rewards"),
      Markup.button.callback("🔗 Connect Account", "connect_account"),
    ],
  ]);
}

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

const bot = new Telegraf(token);

const activeQuestSessions = new Map<
  string,
  {
    questId: string;
    startedAt: number;
  }
>();
const COMMUNITY_CHAT_ID = "1004248298021";
const activeQuizSessions = new Map<
  string,
  {
    questId: string;
    questionIndex: number;
    score: number;
    startedAt: number;
  }
>();

const academyQuestions = [
  {
    question:
      "What is a blockchain?",
    options: [
      {
        label: "A distributed digital ledger",
        correct: true,
      },
      {
        label: "A centralized bank database",
        correct: false,
      },
      {
        label: "A social media platform",
        correct: false,
      },
      {
        label: "A type of computer monitor",
        correct: false,
      },
    ],
  },
  {
    question:
      "What is a cryptocurrency wallet primarily used for?",
    options: [
      {
        label: "Storing and managing access to crypto assets",
        correct: true,
      },
      {
        label: "Printing physical money",
        correct: false,
      },
      {
        label: "Creating internet websites",
        correct: false,
      },
      {
        label: "Sending traditional bank cheques",
        correct: false,
      },
    ],
  },
  {
    question:
      "What does decentralization generally mean in blockchain networks?",
    options: [
      {
        label: "Control is distributed across multiple participants",
        correct: true,
      },
      {
        label: "One company controls the entire network",
        correct: false,
      },
      {
        label: "Only one computer can access the network",
        correct: false,
      },
      {
        label: "Transactions are processed without any computers",
        correct: false,
      },
    ],
  },
];

bot.command("chatid", async (ctx) => {
  await ctx.reply(`Chat ID: ${ctx.chat.id}`);
});

// ================================
// REGISTER / START
// ================================

bot.start(async (ctx) => {

  try {
    const telegramId = String(ctx.from.id);
    const username = ctx.from.username ?? null;
    const displayName =
      `${ctx.from.first_name ?? ""} ${ctx.from.last_name ?? ""}`.trim();

    // Check if member already exists
    const { data: existingMember, error: findError } = await supabase
      .from("members")
      .select("id, total_xp, level, is_banned")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (findError) {
      console.error("Member lookup error:", findError);
      await ctx.reply("Something went wrong. Please try again.");
      return;
    }

    // If member doesn't exist, create them
    if (!existingMember) {
      const { error: insertError } = await supabase
        .from("members")
        .insert({
          telegram_id: telegramId,
          telegram_username: username,
          display_name: displayName || "Aeterna Member",
        });

      if (insertError) {
        console.error("Member creation error:", insertError);
        await ctx.reply("Could not register you. Please try again.");
        return;
      }
    } else if (existingMember.is_banned) {
      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );
      return;
    }

    await ctx.reply(
      `🌟 Welcome to Aeterna, ${displayName || "there"}!\n\n` +
        `You're now part of the Aeterna community.\n\n` +
        `Earn XP by participating in community activities and completing quests.\n\n` +
        `Start with your daily check-in 👇`,
      Markup.inlineKeyboard([
        [Markup.button.callback("🎯 Daily Check-in +10 XP", "daily_checkin")],
      ])
    );
  } catch (error) {
    console.error("Start command error:", error);

    await ctx.reply(
      "Something went wrong while setting up your account. Please try again."
    );
  }
});

// ================================
// COMMUNITY MENU
// ================================

bot.command("menu", async (ctx) => {
  try {
    await ctx.reply(
      `🌟 *Aeterna Community Hub*\n\n` +
        `Everything you need is right here.\n\n` +
        `🎯 Check in daily\n` +
        `📋 Complete quests\n` +
        `⭐ Earn XP\n` +
        `🏆 Climb the leaderboard\n` +
        `🎁 Unlock rewards`,
      {
        parse_mode: "Markdown",
        ...communityMenu(),
      }
    );
  } catch (error) {
    console.error("Community menu error:", error);
    await ctx.reply("Something went wrong.");
  }
});

// ================================
// ZEALY CONNECT
// ================================

bot.command("connect", async (ctx) => {
  try {
    const telegramId = String(ctx.from.id);

    // Find the Aeterna member
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, is_banned")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (memberError) {
      console.error("Connect member lookup error:", memberError);
      await ctx.reply("Something went wrong. Please try again.");
      return;
    }

    if (!member) {
      await ctx.reply(
        "You haven't registered yet.\n\nPlease send /start first."
      );
      return;
    }

    if (member.is_banned) {
      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );
      return;
    }

    // Generate a secure one-time code
    const randomPart = crypto
      .randomBytes(6)
      .toString("hex")
      .toUpperCase();

    const code = `AET-${randomPart}`;

    // Code is valid for 10 minutes
    const expiresAt = new Date(
      Date.now() + 10 * 60 * 1000
    ).toISOString();

    // Remove previous unused codes for this member
    const { error: deleteError } = await supabase
      .from("zealy_link_codes")
      .delete()
      .eq("member_id", member.id)
      .is("used_at", null);

    if (deleteError) {
      console.error("Old link code cleanup error:", deleteError);
      await ctx.reply("Could not create your connection code. Please try again.");
      return;
    }

    // Save new code
    const { error: insertError } = await supabase
      .from("zealy_link_codes")
      .insert({
        member_id: member.id,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Link code creation error:", insertError);
      await ctx.reply("Could not create your connection code. Please try again.");
      return;
    }

    await ctx.reply(
      `🔗 Connect your Aeterna account to Zealy\n\n` +
        `Your one-time connection code is:\n\n` +
        `\`${code}\`\n\n` +
        `⏰ This code expires in 10 minutes.\n\n` +
        `Keep this code private. We'll use it to connect your Telegram account to your Zealy account.`,
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    console.error("Connect command error:", error);

    await ctx.reply(
      "Something went wrong while creating your Zealy connection code."
    );
  }
});

// ================================
// DAILY CHECK-IN
// ================================

bot.action("daily_checkin", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const telegramId = String(ctx.from.id);

    // Find member
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, total_xp, level, is_banned")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (memberError) {
      console.error("Member lookup error:", memberError);
      await ctx.reply("Something went wrong. Please try again.");
      return;
    }

    if (!member) {
      await ctx.reply(
        "You haven't registered yet. Please send /start first."
      );
      return;
    }

    if (member.is_banned) {
      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );
      return;
    }

    // Call Supabase daily check-in function
    const { error: checkinError } = await supabase.rpc("daily_checkin", {
      p_member_id: member.id,
    });

    if (checkinError) {
      console.error("Daily check-in error:", checkinError);

      if (
        checkinError.message
          ?.toLowerCase()
          .includes("already completed")
      ) {
        await ctx.reply(
          "⏰ You've already completed your daily check-in today.\n\n" +
            "Come back tomorrow for another +10 XP."
        );
        return;
      }

      await ctx.reply(
        "We couldn't process your check-in. Please try again."
      );
      return;
    }

    // Get updated XP
    const { data: updatedMember, error: updateError } = await supabase
      .from("members")
      .select("total_xp, level")
      .eq("id", member.id)
      .single();

    if (updateError) {
      console.error("Updated member lookup error:", updateError);

      await ctx.reply(
        "✅ Check-in successful!\n\n" +
          "You earned +10 XP."
      );
      return;
    }

    await ctx.reply(
      `✅ Daily check-in complete!\n\n` +
        `+10 XP earned 🎉\n\n` +
        `⭐ Total XP: ${updatedMember.total_xp}\n` +
        `🏆 Level: ${updatedMember.level}\n\n` +
        `Come back tomorrow for another check-in.`
    );
  } catch (error) {
    console.error("Daily check-in handler error:", error);

    await ctx.reply(
      "Something went wrong while processing your check-in."
    );
  }
});

// ================================
// QUEST CENTER
// ================================

bot.action("quests", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { data: quests, error } = await supabase
      .from("quests")
      .select(
        "id, name, description, platform, xp_reward, quest_type, created_at"
      )
      .eq("is_active", true)
      .eq("platform", "telegram")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Quest lookup error:", error);

      await ctx.reply(
        "Could not load the quest center. Please try again."
      );

      return;
    }

    if (!quests || quests.length === 0) {
      await ctx.reply(
        `📋 *Aeterna Quest Center*\n\n` +
          `There are no active quests available right now.\n\n` +
          `Check back soon.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "🎯 Daily Check-in",
                "daily_checkin"
              ),
            ],
            [
              Markup.button.callback(
                "🔙 Community Hub",
                "community_menu"
              ),
            ],
          ]),
        }
      );

      return;
    }

    let message = `📋 *AETERNA QUEST CENTER*\n\n`;

    quests.forEach((quest, index) => {
      message +=
        `*${index + 1}. ${quest.name}*\n` +
        `${quest.description || "Complete this community quest."}\n` +
        `⭐ Reward: *+${quest.xp_reward} XP*\n\n`;
    });

    // Create one button for each quest
    const questButtons = quests.map((quest) => [
      Markup.button.callback(
        `🚀 Start: ${quest.name}`,
        `start_quest_${quest.id}`
      ),
    ]);

    await ctx.reply(message, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        ...questButtons,
        [
          Markup.button.callback(
            "🎯 Daily Check-in",
            "daily_checkin"
          ),
        ],
        [
          Markup.button.callback(
            "👤 My Profile",
            "profile"
          ),
          Markup.button.callback(
            "🏆 Leaderboard",
            "leaderboard"
          ),
        ],
        [
          Markup.button.callback(
            "🔙 Community Hub",
            "community_menu"
          ),
        ],
      ]),
    });
  } catch (error) {
    console.error("Quest center error:", error);

    await ctx.reply(
      "Something went wrong while loading the quest center."
    );
  }
});

// ================================
// START QUEST
// ================================

bot.action(/^start_quest_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const questId = ctx.match[1];
    const telegramId = String(ctx.from.id);

    // Find the member
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, is_banned")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (memberError) {
      console.error("Start quest member lookup error:", memberError);
      await ctx.reply("Something went wrong. Please try again.");
      return;
    }

    if (!member) {
      await ctx.reply(
        "You haven't registered yet.\n\nPlease send /start first."
      );
      return;
    }

    if (member.is_banned) {
      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );
      return;
    }

    // Find the quest
    const { data: quest, error: questError } = await supabase
      .from("quests")
     .select("id, name, description, xp_reward, quest_type, is_active")
      .eq("id", questId)
      .maybeSingle();

    if (questError) {
      console.error("Start quest lookup error:", questError);
      await ctx.reply("Could not load this quest. Please try again.");
      return;
    }

    if (!quest || !quest.is_active) {
      await ctx.reply(
        "This quest is no longer available."
      );
      return;
    }

    // Check whether the member already completed it
    const { data: existingCompletion, error: completionError } =
      await supabase
        .from("quest_completions")
        .select("id, verified")
        .eq("member_id", member.id)
        .eq("quest_id", quest.id)
        .maybeSingle();

    if (completionError) {
      console.error(
        "Existing quest completion lookup error:",
        completionError
      );

      await ctx.reply(
        "Could not check your quest status. Please try again."
      );

      return;
    }

    if (existingCompletion?.verified) {
      await ctx.reply(
        `✅ *Quest already completed!*\n\n` +
          `You have already completed *${quest.name}*.\n\n` +
          `⭐ XP earned: +${quest.xp_reward}`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "📋 Quest Center",
                "quests"
              ),
            ],
            [
              Markup.button.callback(
                "👤 My Profile",
                "profile"
              ),
            ],
          ]),
        }
      );

      if (quest.quest_type?.toLowerCase() === "quiz") {
  activeQuizSessions.set(telegramId, {
    questId: quest.id,
    questionIndex: 0,
    score: 0,
    startedAt: Date.now(),
  });

  const firstQuestion = academyQuestions[0];

  await ctx.answerCbQuery();

  await ctx.reply(
    `🎓 *Aeterna Academy*\n\n` +
    `Question 1 of ${academyQuestions.length}\n\n` +
    `*${firstQuestion.question}*`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(
        firstQuestion.options.map((option, index) => [
          Markup.button.callback(
            option.label,
            `academy_answer_${index}`
          ),
        ])
      ),
    }
  );

  return;
}
      return;
    }

    // Store the active quest for this Telegram user
    activeQuestSessions.set(telegramId, {
      questId: quest.id,
      startedAt: Date.now(),
    });

    await ctx.reply(
      `🚀 *Quest Started!*\n\n` +
        `*${quest.name}*\n\n` +
        `${quest.description || ""}\n\n` +
        `⭐ Reward: *+${quest.xp_reward} XP*\n\n` +
        `Now send your introduction in your next message.\n\n` +
        `💡 Tell us who you are, what you do, and why you joined Aeterna.\n\n` +
        `Your introduction should be at least *20 characters*.`,
      {
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    console.error("Start quest handler error:", error);

    await ctx.reply(
      "Something went wrong while starting the quest."
    );
  }
});
bot.action(/^academy_answer_(\d+)$/, async (ctx) => {
  const telegramId = String(ctx.from.id);

  const session = activeQuizSessions.get(telegramId);

  if (!session) {
    await ctx.answerCbQuery("Quiz session expired. Please start again.");
    return;
  }

  if (Date.now() - session.startedAt > 15 * 60 * 1000) {
    activeQuizSessions.delete(telegramId);
    await ctx.answerCbQuery("Quiz session expired.");
    await ctx.reply("⏰ Your quiz session expired. Please start the Academy quiz again.");
    return;
  }

  const answerIndex = Number(ctx.match[1]);
  const currentQuestion = academyQuestions[session.questionIndex];

  if (!currentQuestion) {
    activeQuizSessions.delete(telegramId);
    await ctx.answerCbQuery();
    return;
  }

  const selectedOption = currentQuestion.options[answerIndex];

  if (!selectedOption) {
    await ctx.answerCbQuery("Invalid answer.");
    return;
  }

  await ctx.answerCbQuery(
    selectedOption.correct ? "✅ Correct!" : "❌ Incorrect!"
  );

  if (selectedOption.correct) {
    session.score += 1;
  }

  session.questionIndex += 1;

  // More questions remaining
  if (session.questionIndex < academyQuestions.length) {
    activeQuizSessions.set(telegramId, session);

    const nextQuestion = academyQuestions[session.questionIndex];

    await ctx.reply(
      `🎓 *Aeterna Academy*\n\n` +
      `Question ${session.questionIndex + 1} of ${academyQuestions.length}\n\n` +
      `*${nextQuestion.question}*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(
          nextQuestion.options.map((option, index) => [
            Markup.button.callback(
              option.label,
              `academy_answer_${index}`
            ),
          ])
        ),
      }
    );

    return;
  }

  // Quiz finished
  const finalScore = session.score;
  const totalQuestions = academyQuestions.length;

  activeQuizSessions.delete(telegramId);

  if (finalScore < 2) {
    await ctx.reply(
      `🎓 *Aeterna Academy Complete*\n\n` +
      `Your score: *${finalScore}/${totalQuestions}*\n\n` +
      `You need at least *2/${totalQuestions}* correct answers to complete this quest.\n\n` +
      `Try again when you're ready!`,
      { parse_mode: "Markdown" }
    );

    return;
  }

  // Get member
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, total_xp, level")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (memberError || !member) {
    await ctx.reply("❌ Could not find your Aeterna account. Please use /start and try again.");
    return;
  }

  // Get quest
  const { data: quest, error: questError } = await supabase
    .from("quests")
    .select("id, name, xp_reward")
    .eq("id", session.questId)
    .eq("is_active", true)
    .maybeSingle();

  if (questError || !quest) {
    await ctx.reply("❌ This quest is currently unavailable.");
    return;
  }

  // Prevent duplicate completion
  const { data: existingCompletion } = await supabase
    .from("quest_completions")
    .select("id, verified")
    .eq("member_id", member.id)
    .eq("quest_id", quest.id)
    .maybeSingle();

  if (existingCompletion?.verified) {
    await ctx.reply("✅ You have already completed this quest.");
    return;
  }

  // Record completion
  const { data: completion, error: completionError } = await supabase
    .from("quest_completions")
    .insert({
      member_id: member.id,
      quest_id: quest.id,
      xp_awarded: quest.xp_reward,
      verified: true,
      verification_method: "telegram_quiz",
    })
    .select("id")
    .single();

  if (completionError || !completion) {
    console.error("Quiz completion error:", completionError);
    await ctx.reply("❌ Could not record your quiz completion. Please try again.");
    return;
  }

  // Award XP
  const { error: xpError } = await supabase.rpc("award_xp", {
    p_member_id: member.id,
    p_xp_amount: quest.xp_reward,
    p_activity_type: "quest",
    p_platform: "telegram",
    p_description: `Completed quest: ${quest.name}`,
    p_reference_id: quest.id,
  });

  if (xpError) {
    console.error("Quiz XP error:", xpError);

    // Roll back completion if XP award fails
    await supabase
      .from("quest_completions")
      .delete()
      .eq("id", completion.id);

    await ctx.reply(
      "❌ Your completion could not be finalized. No XP was awarded. Please try again."
    );
    return;
  }

  // Get updated XP
  const { data: updatedMember } = await supabase
    .from("members")
    .select("total_xp, level")
    .eq("id", member.id)
    .single();

  await ctx.reply(
    `🎉 *Aeterna Academy Complete!*\n\n` +
    `Score: *${finalScore}/${totalQuestions}* ✅\n\n` +
    `XP earned: *+${quest.xp_reward} XP*\n` +
    `Total XP: *${updatedMember?.total_xp ?? member.total_xp} XP*\n` +
    `Level: *${updatedMember?.level ?? member.level}*\n\n` +
    `Keep going — there are more quests waiting for you!`,
    { parse_mode: "Markdown" }
  );
});

// ================================
// QUEST SUBMISSION
// ================================

bot.on("text", async (ctx, next) => {
  // Community Discussion quest
if (
  (ctx.chat.type === "group" || ctx.chat.type === "supergroup") &&
  String(ctx.chat.id) === COMMUNITY_CHAT_ID
) {
  const telegramId = String(ctx.from.id);
  const messageText = ctx.message.text.trim();

  // Ignore commands
  if (messageText.startsWith("/")) {
    return next();
  }

  // Require a meaningful message
  if (messageText.length < 20) {
    return;
  }

  // Find member
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, total_xp, level")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (memberError || !member) {
    return;
  }

  // Find Community Discussion quest
  const { data: quest, error: questError } = await supabase
    .from("quests")
    .select("id, name, xp_reward")
    .eq("name", "Community Discussion")
    .eq("platform", "telegram")
    .eq("is_active", true)
    .maybeSingle();

  if (questError || !quest) {
    console.error("Community Discussion quest error:", questError);
    return;
  }

  // Check if member already completed today's discussion
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data: todayCompletion } = await supabase
    .from("quest_completions")
    .select("id")
    .eq("member_id", member.id)
    .eq("quest_id", quest.id)
    .gte("completed_at", startOfDay.toISOString())
    .limit(1)
    .maybeSingle();

  if (todayCompletion) {
    return;
  }

  // Record completion
  const { data: completion, error: completionError } = await supabase
    .from("quest_completions")
    .insert({
      member_id: member.id,
      quest_id: quest.id,
      xp_awarded: quest.xp_reward,
      verified: true,
      verification_method: "telegram_group_message",
    })
    .select("id")
    .single();

  if (completionError || !completion) {
    console.error("Community Discussion completion error:", completionError);
    return;
  }

  // Award XP
  const { error: xpError } = await supabase.rpc("award_xp", {
    p_member_id: member.id,
    p_xp_amount: quest.xp_reward,
    p_activity_type: "quest",
    p_platform: "telegram",
    p_description: `Completed quest: ${quest.name}`,
    p_reference_id: quest.id,
  });

  if (xpError) {
    console.error("Community Discussion XP error:", xpError);

    // Roll back completion if XP award fails
    await supabase
      .from("quest_completions")
      .delete()
      .eq("id", completion.id);

    return;
  }

  await ctx.reply(
    `💬 Community Discussion complete!\n\n` +
    `You earned +${quest.xp_reward} XP for participating in the community.`
  );

  return;
}
  try {
    const telegramId = String(ctx.from.id);
    const messageText = ctx.message.text.trim();

    // Ignore commands
    if (messageText.startsWith("/")) {
      return next();
    }

    // Check whether this member has an active quest
    const session = activeQuestSessions.get(telegramId);

    if (!session) {
      return next();
    }

    // Sessions expire after 15 minutes
    const sessionAge = Date.now() - session.startedAt;

    if (sessionAge > 15 * 60 * 1000) {
      activeQuestSessions.delete(telegramId);

      await ctx.reply(
        `⏰ *Quest session expired.*\n\n` +
          `Please open the Quest Center and start the quest again.`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "📋 Quest Center",
                "quests"
              ),
            ],
          ]),
        }
      );

      return;
    }

    // Get member
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, total_xp, level, is_banned")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (memberError || !member) {
      console.error(
        "Quest submission member lookup error:",
        memberError
      );

      await ctx.reply(
        "Could not find your Aeterna account. Please send /start."
      );

      return;
    }

    if (member.is_banned) {
      activeQuestSessions.delete(telegramId);

      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );

      return;
    }

    // Get quest
    const { data: quest, error: questError } = await supabase
      .from("quests")
      .select("id, name, xp_reward, is_active")
      .eq("id", session.questId)
      .maybeSingle();

    if (questError || !quest || !quest.is_active) {
      console.error(
        "Quest submission quest lookup error:",
        questError
      );

      activeQuestSessions.delete(telegramId);

      await ctx.reply(
        "This quest is no longer available."
      );

      return;
    }

    // Basic validation for the introduction
    if (messageText.length < 20) {
      await ctx.reply(
        `✍️ *That's a little too short.*\n\n` +
          `Please write at least *20 characters* so we can count your introduction as a valid submission.\n\n` +
          `Tell us a little about yourself and why you joined Aeterna.`,
        {
          parse_mode: "Markdown",
        }
      );

      return;
    }

    // Check again for an existing completion
    const { data: existingCompletion, error: existingError } =
      await supabase
        .from("quest_completions")
        .select("id, verified")
        .eq("member_id", member.id)
        .eq("quest_id", quest.id)
        .maybeSingle();

    if (existingError) {
      console.error(
        "Quest completion check error:",
        existingError
      );

      await ctx.reply(
        "Could not verify your quest status. Please try again."
      );

      return;
    }

    if (existingCompletion?.verified) {
      activeQuestSessions.delete(telegramId);

      await ctx.reply(
        `✅ *Quest already completed!*\n\n` +
          `You've already completed *${quest.name}*.\n\n` +
          `⭐ XP earned: +${quest.xp_reward}`,
        {
          parse_mode: "Markdown",
        }
      );

      return;
    }

    // Record quest completion
    const { error: completionInsertError } = await supabase
      .from("quest_completions")
      .insert({
        member_id: member.id,
        quest_id: quest.id,
        xp_awarded: quest.xp_reward,
        verified: true,
        verification_method: "telegram_message",
      });

    if (completionInsertError) {
      console.error(
        "Quest completion insert error:",
        completionInsertError
      );

      await ctx.reply(
        "We couldn't record your quest completion. Please try again."
      );

      return;
    }

    // Award XP through the existing XP system
   const { error: xpError } = await supabase.rpc("award_xp", {
  p_member_id: member.id,
  p_xp_amount: quest.xp_reward,
  p_activity_type: "quest",
  p_platform: "telegram",
  p_description: `Completed quest: ${quest.name}`,
  p_reference_id: quest.id,
});

    if (xpError) {
  console.error("Quest XP award error:", xpError);

  // Remove the completion record so the member can retry
  // if the XP award failed.
  const { error: rollbackError } = await supabase
    .from("quest_completions")
    .delete()
    .eq("member_id", member.id)
    .eq("quest_id", quest.id);

  if (rollbackError) {
    console.error(
      "Quest completion rollback error:",
      rollbackError
    );
  }

  await ctx.reply(
    `⚠️ We couldn't award your XP yet.\n\n` +
      `Your quest was not completed. Please try submitting again.`,
    {
      parse_mode: "Markdown",
    }
  );

  activeQuestSessions.delete(telegramId);

  return;
}

    // Get updated member data
    const { data: updatedMember } = await supabase
      .from("members")
      .select("total_xp, level")
      .eq("id", member.id)
      .single();

    activeQuestSessions.delete(telegramId);

    await ctx.reply(
      `🎉 *Quest Completed!*\n\n` +
        `✅ ${quest.name}\n\n` +
        `⭐ +${quest.xp_reward} XP earned!\n\n` +
        `⭐ Total XP: ${updatedMember?.total_xp ?? "Updated"}\n` +
        `🏆 Level: ${updatedMember?.level ?? "Updated"}\n\n` +
        `Keep participating in the Aeterna community to earn more XP.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "📋 More Quests",
              "quests"
            ),
          ],
          [
            Markup.button.callback(
              "🏆 Leaderboard",
              "leaderboard"
            ),
          ],
          [
            Markup.button.callback(
              "👤 My Profile",
              "profile"
            ),
          ],
        ]),
      }
    );
  } catch (error) {
    console.error(
      "Quest submission handler error:",
      error
    );

    await ctx.reply(
      "Something went wrong while processing your quest submission."
    );
  }
});

// ================================
// MY PROFILE
// ================================

bot.action("profile", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const telegramId = String(ctx.from.id);

    const { data: member, error } = await supabase
      .from("members")
      .select(
        "display_name, telegram_username, total_xp, level, is_banned"
      )
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (error) {
      console.error("Profile lookup error:", error);
      await ctx.reply("Could not load your profile. Please try again.");
      return;
    }

    if (!member) {
      await ctx.reply(
        "You haven't registered yet.\n\nPlease send /start first."
      );
      return;
    }

    if (member.is_banned) {
      await ctx.reply(
        "Your Aeterna account is currently restricted from participating."
      );
      return;
    }

    const name = member.display_name || "Aeterna Member";

    const username = member.telegram_username
      ? `@${member.telegram_username}`
      : "Not set";

    await ctx.reply(
      `👤 *Your Aeterna Profile*\n\n` +
        `Name: ${name}\n` +
        `Username: ${username}\n\n` +
        `⭐ XP: ${member.total_xp}\n` +
        `🏆 Level: ${member.level}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "🎯 Daily Check-in",
              "daily_checkin"
            ),
          ],
          [
            Markup.button.callback(
              "🏆 Leaderboard",
              "leaderboard"
            ),
          ],
          [
            Markup.button.callback(
              "🔙 Community Hub",
              "community_menu"
            ),
          ],
        ]),
      }
    );
  } catch (error) {
    console.error("Profile handler error:", error);

    await ctx.reply(
      "Something went wrong while loading your profile."
    );
  }
});

// ================================
// LEADERBOARD
// ================================

bot.action("leaderboard", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { data: members, error } = await supabase
      .from("members")
      .select(
        "display_name, telegram_username, total_xp, level"
      )
      .eq("is_active", true)
      .eq("is_banned", false)
      .order("total_xp", { ascending: false })
      .limit(10);

    if (error) {
      console.error("Leaderboard lookup error:", error);
      await ctx.reply(
        "Could not load the leaderboard. Please try again."
      );
      return;
    }

    if (!members || members.length === 0) {
      await ctx.reply(
        "🏆 The Aeterna leaderboard is empty for now."
      );
      return;
    }

    let leaderboard = `🏆 *AETERNA LEADERBOARD*\n\n`;

    members.forEach((member, index) => {
      const position = index + 1;

      let rank = `${position}.`;

      if (position === 1) rank = "🥇";
      if (position === 2) rank = "🥈";
      if (position === 3) rank = "🥉";

      const name =
        member.display_name ||
        (member.telegram_username
          ? `@${member.telegram_username}`
          : "Aeterna Member");

      leaderboard +=
        `${rank} *${name}*\n` +
        `   ⭐ ${member.total_xp} XP · Level ${member.level}\n\n`;
    });

    await ctx.reply(leaderboard, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "👤 My Profile",
            "profile"
          ),
        ],
        [
          Markup.button.callback(
            "🎯 Daily Check-in",
            "daily_checkin"
          ),
        ],
        [
          Markup.button.callback(
            "🔙 Community Hub",
            "community_menu"
          ),
        ],
      ]),
    });
  } catch (error) {
    console.error("Leaderboard handler error:", error);

    await ctx.reply(
      "Something went wrong while loading the leaderboard."
    );
  }
});


// ================================
// TELEGRAM WEBHOOK
// ================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    await bot.handleUpdate(body);

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    console.error("Telegram webhook error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Webhook processing failed",
      },
      { status: 500 }
    );
  }
}