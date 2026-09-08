import { NextRequest, NextResponse } from "next/server";
import { Telegraf, Markup } from "telegraf";
import { supabase } from "@/lib/supabase";

const token = process.env.TELEGRAM_BOT_TOKEN;

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