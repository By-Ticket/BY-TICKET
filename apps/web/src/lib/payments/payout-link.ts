/** True when the signed-in organizer must not attach this payout to a SEP-24 withdraw. */
export function payoutLinkDenied(input: {
  payout: { event_id: string } | null;
  event: { id: string; organizer_id: string } | null;
  organizerId: string | null;
}): boolean {
  if (!input.payout || !input.event || !input.organizerId) return true;
  return input.event.id !== input.payout.event_id || input.event.organizer_id !== input.organizerId;
}
