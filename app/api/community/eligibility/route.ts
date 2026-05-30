/**
 * Public read endpoint: "is this wallet a GVC community member?"
 *
 * The client uses this to decide whether to show the community-member
 * pill and route renders through the free path. The server still
 * re-runs the same check on the actual render call — this endpoint is
 * purely a UX nicety so the UI knows when to surface the free option.
 *
 * Threat model: anyone can hit this with any wallet address (it's
 * read-only on-chain data); no auth. The cache in
 * lib/community-eligibility.ts protects the RPC from burst calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkCommunityEligibility } from "@/lib/community-eligibility";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: "Bad `wallet` query param (expected 0x… 40-hex)." },
      { status: 400 }
    );
  }

  const eligibility = await checkCommunityEligibility(
    wallet.toLowerCase() as `0x${string}`
  );

  return NextResponse.json(
    {
      isMember: eligibility.isMember,
      qualifier: eligibility.qualifier,
      gvcCount: eligibility.gvcCount.toString(),
      vibestrBalance: eligibility.vibestrBalance.toString(),
      vibestrWhole: eligibility.vibestrWhole.toString(),
    },
    {
      // Short cache so a wallet that just bought a GVC NFT sees their
      // status update within a couple of minutes. The server-side cache
      // is the real protection; this is just an HTTP-level hint.
      headers: { "cache-control": "public, max-age=60" },
    }
  );
}
