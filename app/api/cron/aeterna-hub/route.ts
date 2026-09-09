import { NextResponse } from "next/server";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;

const COMMUNITY_CHAT_ID = "-1004248298021";
const AETERNA_HUB_THREAD_ID = 21031;

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!token) {
      return NextResponse.json(
        { error: "Missing TELEGRAM_BOT_TOKEN" },
        { status: 500 }
      );
    }

    const bot = new Telegraf(token);

    await bot.telegram.sendMessage(
      COMMUNITY_CHAT_ID,
      `🌟 *Aeterna Community Hub*\n\n` +
        `Good morning, Aeterna 👋\n\n` +
        `Your daily XP activities are ready.\n\n` +
        `🎯 Check in daily\n` +
        `🎓 Complete the Aeterna Academy\n` +
        `📋 Complete quests\n` +
        `💬 Participate in the community\n` +
        `🏆 Climb the leaderboard\n` +
        `🎁 Unlock rewards`,
      {
        message_thread_id: AETERNA_HUB_THREAD_ID,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🎯 Daily Check-in",
                callback_data: "daily_checkin",
              },
              {
                text: "👤 My Profile",
                callback_data: "profile",
              },
            ],
            [
              {
                text: "📋 Quest Center",
                callback_data: "quests",
              },
              {
                text: "🏆 Leaderboard",
                callback_data: "leaderboard",
              },
            ],
            [
              {
                text: "🎁 Rewards",
                callback_data: "rewards",
              },
              {
                text: "🔗 Connect Account",
                callback_data: "connect_account",
              },
            ],
          ],
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Aeterna Hub cron error:", error);

    return NextResponse.json(
      { error: "Failed to send Aeterna Hub" },
      { status: 500 }
    );
  }
}