document.addEventListener('DOMContentLoaded', () => {
  const requestButton = document.getElementById('requestPermission');
  const statusText = document.getElementById('status');

  requestButton.addEventListener('click', async () => {
    try {
      statusText.textContent = 'Requesting microphone permission...';
      statusText.className = '';

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Permission granted - stop the tracks immediately
      stream.getTracks().forEach(track => track.stop());

      // Update UI
      statusText.textContent = '✅ Microphone permission granted! You can now use voice input.';
      statusText.className = 'success';
      requestButton.textContent = 'Permission Granted';
      requestButton.disabled = true;

      // Close window after a short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      console.error('Permission denied or error:', error);

      let errorMessage = 'Permission denied. ';

      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please click "Allow" when prompted for microphone access.';
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No microphone found. Please check your audio devices.';
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
        statusText.textContent = '✅ Microphone permission already granted!';
        statusText.className = 'success';
        requestButton.textContent = 'Permission Already Granted';
        requestButton.disabled = true;
      }
    })
    .catch(err => {
      console.log('Permission query not supported:', err);
    });
});
