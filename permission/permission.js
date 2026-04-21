document.addEventListener('DOMContentLoaded', () => {
  // Set up i18n text content
  document.getElementById('title').textContent = chrome.i18n.getMessage('permissions_microphone_title');
  document.getElementById('description').textContent = chrome.i18n.getMessage('permissions_microphone_description');

  const requestButton = document.getElementById('requestPermission');
  const statusText = document.getElementById('status');

  requestButton.textContent = chrome.i18n.getMessage('permissions_microphone_grantButton');

  requestButton.addEventListener('click', async () => {
    try {
      statusText.textContent = chrome.i18n.getMessage('permissions_microphone_requesting');
      statusText.className = '';

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Permission granted - stop the tracks immediately
      stream.getTracks().forEach(track => track.stop());

      // Update UI
      statusText.textContent = chrome.i18n.getMessage('permissions_microphone_grantedSuccess');
      statusText.className = 'success';
      requestButton.textContent = chrome.i18n.getMessage('permissions_microphone_grantedButton');
      requestButton.disabled = true;

      // Close window after a short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error('Permission denied or error:', error);

      let errorMessage = chrome.i18n.getMessage('permissions_microphone_denied');

      if (error.name === 'NotAllowedError') {
        errorMessage += chrome.i18n.getMessage('permissions_microphone_allowHelp');
      } else if (error.name === 'NotFoundError') {
        errorMessage += chrome.i18n.getMessage('permissions_microphone_notFound');
      } else {
        errorMessage += error.message;
      }

      statusText.textContent = '❌ ' + errorMessage;
      statusText.className = 'error';
    }
  });

  // Check if permission is already granted
  navigator.permissions
    .query({ name: 'microphone' })
    .then(permissionStatus => {
      if (permissionStatus.state === 'granted') {
        statusText.textContent = chrome.i18n.getMessage('permissions_microphone_alreadyGranted');
        statusText.className = 'success';
        requestButton.textContent = chrome.i18n.getMessage('permissions_microphone_alreadyGrantedButton');
        requestButton.disabled = true;
      }
    })
    .catch(err => {
      console.log('Permission query not supported:', err);
    });
});
