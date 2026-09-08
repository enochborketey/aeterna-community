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