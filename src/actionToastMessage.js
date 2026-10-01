export function actionLoadingMessage(actionKey) {
  if (actionKey.startsWith('mint')) return 'Minting your taxi NFT…';
  if (actionKey.startsWith('claim')) return 'Claiming rewards…';
  if (actionKey.startsWith('repair')) return 'Repairing your taxi…';
  if (actionKey.startsWith('transfer')) return 'Transferring your taxi…';
  if (actionKey.startsWith('activate')) return 'Activating your trainee taxi…';
  return 'Submitting transaction…';
}
