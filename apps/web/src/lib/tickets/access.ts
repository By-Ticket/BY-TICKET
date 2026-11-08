export function assertOwnTicket<T extends { owner_user_id: string | null; owner_public_key: string }>(
  ticket: T | null,
  userId: string,
  publicKey?: string,
): asserts ticket is T {
  if (!ticket) throw new Error("That ticket was not found.");
  if (ticket.owner_user_id !== userId && ticket.owner_public_key !== publicKey) {
    throw new Error("That ticket is not yours.");
  }
}

export function assertOrganizerEvent<T extends { organizer_id: string }>(
  event: T | null,
  organizerId: string,
): asserts event is T {
  if (!event || event.organizer_id !== organizerId) {
    throw new Error("That event is not yours.");
  }
}
