document.addEventListener('DOMContentLoaded', () => {
  // Set up i18n text content
  document.getElementById('title').textContent = chrome.i18n.getMessage('permissionTitle');
  document.getElementById('description').textContent = chrome.i18n.getMessage('permissionDescription');

  const requestButton = document.getElementById('requestPermission');
  const statusText = document.getElementById('status');

  requestButton.textContent = chrome.i18n.getMessage('permissionGrantButton');

  requestButton.addEventListener('click', async () => {
    try {
      statusText.textContent = chrome.i18n.getMessage('permissionRequesting');
      statusText.className = '';

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Permission granted - stop the tracks immediately
      stream.getTracks().forEach(track => track.stop());

      // Update UI
      statusText.textContent = chrome.i18n.getMessage('permissionGrantedSuccess');
      statusText.className = 'success';
      requestButton.textContent = chrome.i18n.getMessage('permissionGrantedButton');
      requestButton.disabled = true;

      // Close window after a short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error('Permission denied or error:', error);

      let errorMessage = chrome.i18n.getMessage('permissionDenied');

      if (error.name === 'NotAllowedError') {
        errorMessage += chrome.i18n.getMessage('permissionAllowHelp');
      } else if (error.name === 'NotFoundError') {
        errorMessage += chrome.i18n.getMessage('permissionNoMicrophone');
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
        statusText.textContent = chrome.i18n.getMessage('permissionAlreadyGranted');
        statusText.className = 'success';
        requestButton.textContent = chrome.i18n.getMessage('permissionAlreadyGrantedButton');
        requestButton.disabled = true;
      }
    })
    .catch(err => {
      console.log('Permission query not supported:', err);
    });
});
