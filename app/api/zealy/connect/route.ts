import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

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

  // Remove the signature before calculating the expected signature
  url.searchParams.delete("signature");

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(url.toString());

  const expectedSignature = hmac.digest("hex");

  return expectedSignature === signature;
}

export async function GET(req: NextRequest) {
  try {
    const requestUrl = req.url;
    const url = new URL(requestUrl);

    const zealyUserId = url.searchParams.get("zealyUserId");
    const signature = url.searchParams.get("signature");

    // Zealy documentation has used callback/callbackUrl naming.
    const callbackUrl =
      url.searchParams.get("callback") ??
      url.searchParams.get("callbackUrl");

    if (!zealyUserId || !signature || !callbackUrl) {
      return NextResponse.json(
        {
          error: "Missing Zealy Connect parameters",
        },
        { status: 400 }
      );
    }

    const validSignature = verifySignature(
      requestUrl,
      signature,
      zealySecret
    );

    if (!validSignature) {
      return NextResponse.json(
        {
          error: "Invalid Zealy signature",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Zealy account verified successfully",
      zealyUserId,
    });
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