import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

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
          details: tokenData,
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

    return NextResponse.json({
      success: true,
      message: "X account connected successfully",
      x_user_id: xUser.id,
      x_username: xUser.username,
      x_name: xUser.name,
    });
  } catch (error) {
    console.error("X callback error:", error);

    return NextResponse.json(
      { error: "X OAuth callback failed" },
      { status: 500 }
    );
  }
}