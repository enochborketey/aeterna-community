import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) {
      return NextResponse.json(
        { error: "Missing authorization code or state" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();

    const savedState = cookieStore.get("x_oauth_state")?.value;
    const codeVerifier = cookieStore.get("x_oauth_verifier")?.value;

    if (!savedState || !codeVerifier || state !== savedState) {
      return NextResponse.json(
        { error: "Invalid OAuth state" },
        { status: 400 }
      );
    }

    // Decode the Telegram member ID from our signed state.
    let memberId: string;

    try {
      const decodedState = Buffer.from(state, "base64url").toString("utf8");

      const parts = decodedState.split(".");

      if (parts.length !== 3) {
        throw new Error("Invalid state format");
      }

      const [decodedMemberId, timestamp, signature] = parts;

      const secret = process.env.X_OAUTH_STATE_SECRET;

      if (!secret) {
        throw new Error("Missing X_OAUTH_STATE_SECRET");
      }

      const payload = `${decodedMemberId}.${timestamp}`;

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");

      if (
        !crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        )
      ) {
        throw new Error("Invalid state signature");
      }

      const stateAge = Date.now() - Number(timestamp);

      if (stateAge > 10 * 60 * 1000) {
        throw new Error("Connection request expired");
      }

      memberId = decodedMemberId;
    } catch (error) {
      console.error("X state verification error:", error);

      return NextResponse.json(
        { error: "Invalid or expired connection request" },
        { status: 400 }
      );
    }

    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "Missing X OAuth credentials" },
        { status: 500 }
      );
    }

    const redirectUri =
      "https://aeterna-community-7ziu.vercel.app/api/x/callback";

    const basicAuth = Buffer.from(
      `${clientId}:${clientSecret}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://api.x.com/2/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("X token error:", tokenData);

      return NextResponse.json(
        {
          error: "X authorization failed",
        },
        { status: 400 }
      );
    }

    const accessToken = tokenData.access_token;

    const userResponse = await fetch(
      "https://api.x.com/2/users/me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const userData = await userResponse.json();

    if (!userResponse.ok) {
      console.error("X user error:", userData);

      return NextResponse.json(
        { error: "Could not retrieve X account" },
        { status: 400 }
      );
    }

    const xUser = userData.data;

    // Make sure the Telegram member still exists.
    const { data: member, error: memberError } = await supabase
  .from("members")
  .select("id, telegram_id, x_username")
  .eq("id", memberId)
  .maybeSingle();


    if (memberError || !member) {
      console.error("Member lookup error:", memberError);

      return NextResponse.json(
        { error: "Aeterna member account not found" },
        { status: 400 }
      );
    }
    const isFirstXConnection = !member.x_username;

    // Check whether this X account is already connected.
    const { data: existingLink, error: existingError } = await supabase
      .from("platform_links")
      .select("id, member_id")
      .eq("platform", "x")
      .eq("platform_user_id", xUser.id)
      .maybeSingle();

    if (existingError) {
      console.error("Existing X link lookup error:", existingError);

      return NextResponse.json(
        { error: "Could not check existing X connection" },
        { status: 500 }
      );
    }

    // If this X account belongs to another Aeterna member, don't allow takeover.
    if (existingLink && existingLink.member_id !== memberId) {
      return NextResponse.json(
        {
          error:
            "This X account is already connected to another Aeterna account.",
        },
        { status: 409 }
      );
    }

    if (existingLink) {
      const { error: updateLinkError } = await supabase
        .from("platform_links")
       .update({
  platform_username: xUser.username,
  verified: true,
  verified_at: new Date().toISOString(),
  x_access_token: accessToken,
  x_refresh_token: tokenData.refresh_token ?? null,
  x_token_expires_at: tokenData.expires_in
    ? new Date(
        Date.now() + Number(tokenData.expires_in) * 1000
      ).toISOString()
    : null,
})
        .eq("id", existingLink.id);

      if (updateLinkError) {
        console.error("X link update error:", updateLinkError);

        return NextResponse.json(
          { error: "Could not update X connection" },
          { status: 500 }
        );
      }
    } else {
      const { error: insertLinkError } = await supabase
        .from("platform_links")
        .insert({
  member_id: memberId,
  platform: "x",
  platform_user_id: xUser.id,
  platform_username: xUser.username,
  verified: true,
  verified_at: new Date().toISOString(),
  x_access_token: accessToken,
  x_refresh_token: tokenData.refresh_token ?? null,
  x_token_expires_at: tokenData.expires_in
    ? new Date(
        Date.now() + Number(tokenData.expires_in) * 1000
      ).toISOString()
    : null,
})

      if (insertLinkError) {
        console.error("X link insert error:", insertLinkError);

        return NextResponse.json(
          { error: "Could not save X connection" },
          { status: 500 }
        );
      }
    }

    // Also update the member's X username.
    const { error: memberUpdateError } = await supabase
      .from("members")
      .update({
        x_username: xUser.username,
      })
      .eq("id", memberId);

    if (memberUpdateError) {
      console.error("Member X username update error:", memberUpdateError);
    }

    // Send the Aeterna X introduction prompt after the member's first X connection.
if (isFirstXConnection && member.telegram_id) {
  try {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!telegramToken) {
      console.error("Missing TELEGRAM_BOT_TOKEN");
    } else {
      const postText =
        "Excited to be part of the @Aeterna_Web3 community! Looking forward to learning, contributing and growing with everyone in the ecosystem. 🌐";

      const composeUrl = `https://x.com/intent/post?text=${encodeURIComponent(
        postText
      )}`;

      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: member.telegram_id,
            text:
              `🎉 X Account Connected!\n\n` +
              `Your X account @${xUser.username} is now connected to Aeterna.\n\n` +
              `🚀 Next Step: Introduce Aeterna on X\n\n` +
              `Share why you're excited to be part of Aeterna and tag @Aeterna_Web3.\n\n` +
              `We've prepared a post for you. Just tap the button below, review it, and publish it.`,
           reply_markup: {
  inline_keyboard: [
    [
      {
        text: "📝 Make My Aeterna Post",
        url: composeUrl,
      },
    ],
    [
      {
        text: "✅ I've Posted — Verify",
        callback_data: "verify_x_intro",
      },
    ],
  ],
},
          }),
        }
      );

      if (!telegramResponse.ok) {
        console.error(
          "Failed to send X introduction prompt:",
          await telegramResponse.text()
        );
      }
    }
  } catch (telegramError) {
    console.error(
      "Telegram X introduction prompt error:",
      telegramError
    );
  }
}

    // Clear the temporary OAuth cookies.
    const response = NextResponse.json({
      success: true,
      message: "X account connected successfully",
      x_username: xUser.username,
      x_name: xUser.name,
    });

    response.cookies.delete("x_oauth_state");
    response.cookies.delete("x_oauth_verifier");

    return response;
  } catch (error) {
    console.error("X callback error:", error);

    return NextResponse.json(
      { error: "X OAuth callback failed" },
      { status: 500 }
    );
  }
}