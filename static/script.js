document.addEventListener('DOMContentLoaded', function() {
    // Elements
    const localPortInfo = document.getElementById('local-port-info');
    const errorBanner = document.getElementById('error-banner');
    const connectionForm = document.getElementById('connection-form');
    const destIpInput = document.getElementById('destIp');
    const destPortInput = document.getElementById('destPort');
    const messagesContainer = document.getElementById('messages-container');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    
    // Connection state
    let isConnected = false;
    
    // Initialize Socket.IO
    const socket = io();
    
    // Load initial config
    fetch('/config')
        .then(response => response.json())
        .then(data => {
            localPortInfo.textContent = `Your local UDP port: ${data.local_port}`;
            
            if (data.dest_ip && data.dest_port) {
                destIpInput.value = data.dest_ip;
                destPortInput.value = data.dest_port;
                enableChat();
            }
        })
        .catch(error => {
            showError("Failed to load configuration");
            console.error('Error:', error);
        });
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to WebSocket server');
    });
    
    socket.on('connection_status', (data) => {
        localPortInfo.textContent = `Your local UDP port: ${data.local_port}`;
    });
    
    socket.on('receive_message', (data) => {
        addMessage('received', data.sender, data.message, new Date(data.timestamp * 1000));
        scrollToBottom();
    });
    
    socket.on('message_sent', (data) => {
        addMessage('sent', 'You', data.message, new Date(data.timestamp * 1000));
        messageInput.value = '';
        scrollToBottom();
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
    
    // Form submit event handlers
    connectionForm.addEventListener('submit', function(event) {
        event.preventDefault();
        
        const destIp = destIpInput.value.trim();
        const destPort = destPortInput.value.trim();
        
        if (!destIp || !destPort) {
            showError('Please enter destination IP and port');
            return;
        }
        
        fetch('/connect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ip: destIp,
                port: parseInt(destPort)
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                enableChat();
                showSuccess(`Connected to ${destIp}:${destPort}`);
            } else {
                showError(data.message || 'Failed to connect');
            }
        })
        .catch(error => {
            showError('Failed to connect');
            console.error('Error:', error);
        });
    });
    
    messageForm.addEventListener('submit', function(event) {
        event.preventDefault();
        
        const messageText = messageInput.value.trim();
        if (!messageText) return;
        
        socket.emit('send_message', { message: messageText });
    });
    
    // Helper functions
    function showError(message) {
        errorBanner.textContent = message;
        errorBanner.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            errorBanner.style.display = 'none';
        }, 5000);
    }
    
    function showSuccess(message) {
        errorBanner.textContent = message;
        errorBanner.style.backgroundColor = '#dff0d8';
        errorBanner.style.color = '#3c763d';
        errorBanner.style.display = 'block';
        
        // Hide after 3 seconds
        setTimeout(() => {
            errorBanner.style.display = 'none';
            // Reset colors
            errorBanner.style.backgroundColor = '#ffdddd';
            errorBanner.style.color = '#ff0000';
        }, 3000);
    }
    
    function enableChat() {
        isConnected = true;
        messageInput.disabled = false;
        sendButton.disabled = false;
    }
    
    function addMessage(type, sender, content, timestamp) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        if (sender && type === 'received') {
            const senderDiv = document.createElement('div');
            senderDiv.className = 'message-sender';
            senderDiv.textContent = sender;
            messageDiv.appendChild(senderDiv);
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = content;
        messageDiv.appendChild(contentDiv);
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = formatTime(timestamp);
        messageDiv.appendChild(timeDiv);
        
        messagesContainer.appendChild(messageDiv);
    }
    
    function formatTime(date) {
        return date.toLocaleTimeString();
    }
    
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
});