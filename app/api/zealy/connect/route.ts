import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";

const zealySecret = process.env.ZEALY_CONNECT_SECRET ?? "";

if (!zealySecret) {
  throw new Error("Missing ZEALY_CONNECT_SECRET");
}

function verifySignature(
  requestUrl: string,
  signature: string,
  secret: string
) {
  const url = new URL(requestUrl);

  // Remove signature before calculating expected signature
  url.searchParams.delete("signature");

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(url.toString());

  const expectedSignature = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

export async function GET(req: NextRequest) {
  try {
    const requestUrl = req.url;
    const url = new URL(requestUrl);

    const zealyUserId = url.searchParams.get("zealyUserId");
    const signature = url.searchParams.get("signature");

    const callbackUrl =
      url.searchParams.get("callback") ??
      url.searchParams.get("callbackUrl");

    /*
     * The Telegram member provides this code when connecting.
     * Zealy will send it back as part of the Connect flow.
     */
    const code = url.searchParams.get("code");

    if (!zealyUserId || !signature || !callbackUrl || !code) {
      return NextResponse.json(
        {
          error: "Missing Zealy Connect parameters",
        },
        { status: 400 }
      );
    }

    // Verify Zealy's signature first
    let validSignature = false;

    try {
      validSignature = verifySignature(
        requestUrl,
        signature,
        zealySecret
      );
    } catch {
      validSignature = false;
    }

    if (!validSignature) {
      return NextResponse.json(
        {
          error: "Invalid Zealy signature",
        },
        { status: 400 }
      );
    }

    // Find the temporary Telegram ↔ Zealy linking code
    const { data: linkCode, error: linkCodeError } = await supabase
      .from("zealy_link_codes")
      .select("id, member_id, code, expires_at, used_at")
      .eq("code", code)
      .maybeSingle();

    if (linkCodeError) {
      console.error("Link code lookup error:", linkCodeError);

      return NextResponse.json(
        {
          error: "Could not verify connection code",
        },
        { status: 500 }
      );
    }

    if (!linkCode) {
      return NextResponse.json(
        {
          error: "Invalid connection code",
        },
        { status: 400 }
      );
    }

    // Check whether the code was already used
    if (linkCode.used_at) {
      return NextResponse.json(
        {
          error: "This connection code has already been used",
        },
        { status: 400 }
      );
    }

    // Check expiration
    if (new Date(linkCode.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        {
          error: "This connection code has expired",
        },
        { status: 400 }
      );
    }

    // Get the Aeterna member
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, telegram_id, telegram_username, is_banned")
      .eq("id", linkCode.member_id)
      .maybeSingle();

    if (memberError) {
      console.error("Member lookup error:", memberError);

      return NextResponse.json(
        {
          error: "Could not find Aeterna member",
        },
        { status: 500 }
      );
    }

    if (!member) {
      return NextResponse.json(
        {
          error: "Aeterna member not found",
        },
        { status: 400 }
      );
    }

    if (member.is_banned) {
      return NextResponse.json(
        {
          error: "This Aeterna account is restricted",
        },
        { status: 403 }
      );
    }

    // Check whether this Zealy account is already connected
    const { data: existingZealyLink, error: existingLinkError } =
      await supabase
        .from("platform_links")
        .select("id, member_id")
        .eq("platform", "zealy")
        .eq("platform_user_id", zealyUserId)
        .maybeSingle();

    if (existingLinkError) {
      console.error(
        "Existing Zealy link lookup error:",
        existingLinkError
      );

      return NextResponse.json(
        {
          error: "Could not check existing Zealy connection",
        },
        { status: 500 }
      );
    }

    if (
      existingZealyLink &&
      existingZealyLink.member_id !== member.id
    ) {
      return NextResponse.json(
        {
          error:
            "This Zealy account is already connected to another Aeterna account",
        },
        { status: 400 }
      );
    }

    // Create the Zealy platform link
    if (!existingZealyLink) {
      const { error: insertLinkError } = await supabase
        .from("platform_links")
        .insert({
          member_id: member.id,
          platform: "zealy",
          platform_user_id: zealyUserId,
          verified: true,
          verified_at: new Date().toISOString(),
        });

      if (insertLinkError) {
        console.error(
          "Zealy platform link error:",
          insertLinkError
        );

        return NextResponse.json(
          {
            error: "Could not save Zealy connection",
          },
          { status: 500 }
        );
      }
    }

    // Also store the Zealy ID directly on the member
    const { error: memberUpdateError } = await supabase
      .from("members")
      .update({
        zealy_id: zealyUserId,
      })
      .eq("id", member.id);

    if (memberUpdateError) {
      console.error(
        "Member Zealy ID update error:",
        memberUpdateError
      );

      return NextResponse.json(
        {
          error: "Could not update Aeterna member",
        },
        { status: 500 }
      );
    }

    // Mark the temporary code as used
    const { error: usedCodeError } = await supabase
      .from("zealy_link_codes")
      .update({
        used_at: new Date().toISOString(),
      })
      .eq("id", linkCode.id)
      .is("used_at", null);

    if (usedCodeError) {
      console.error(
        "Link code update error:",
        usedCodeError
      );

      return NextResponse.json(
        {
          error: "Could not complete connection",
        },
        { status: 500 }
      );
    }

    /*
     * Zealy expects us to redirect to its callback with our
     * platform identifier and a signature.
     */
    const callback = new URL(callbackUrl);

    callback.searchParams.set(
      "identifier",
      member.telegram_id ?? member.id
    );

    const callbackWithoutSignature = callback.toString();

    const callbackHmac = crypto.createHmac(
      "sha256",
      zealySecret
    );

    callbackHmac.update(callbackWithoutSignature);

    callback.searchParams.set(
      "signature",
      callbackHmac.digest("hex")
    );

    return NextResponse.redirect(callback.toString());
  } catch (error) {
    console.error("Zealy Connect error:", error);

    return NextResponse.json(
      {
        error: "Zealy Connect failed",
      },
      { status: 500 }
    );
  }
}