import { NextRequest, NextResponse } from "next/server";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

const bot = new Telegraf(token);

bot.start(async (ctx) => {
  const firstName = ctx.from.first_name || "there";

  await ctx.reply(
    `🌟 Welcome to Aeterna, ${firstName}!\n\n` +
    `You're now part of the Aeterna community.\n\n` +
    `Start earning XP by participating in the community.\n\n` +
    `Use the buttons below to get started.`
  );
});

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