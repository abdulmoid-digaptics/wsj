export function orderCancellationQuery(reference: string, message: string) {
  return {type: 'SUPPORT', subject: 'Help with order cancellation', message: message.trim(), reference};
}
