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
    const nicknameInput = document.getElementById('nickname');
    const saveNicknameBtn = document.getElementById('save-nickname');
    const savedConnectionsList = document.getElementById('saved-connections-list');
    const loadConnectionBtn = document.getElementById('load-connection');
    const deleteConnectionBtn = document.getElementById('delete-connection');
    const currentPeerElement = document.getElementById('current-peer');
    const peersDropdown = document.getElementById('discovered-peers');
    const connectToPeerBtn = document.getElementById('connect-to-peer-btn');
    
    // Connection state
    let isConnected = false;
    let currentPeer = null;
    let discoveredPeers = {};
    
    // Initialize Socket.IO
    const socket = io();
    
    // Load saved nickname
    const savedNickname = localStorage.getItem('nickname');
    if (savedNickname) {
        nicknameInput.value = savedNickname;
        // Send nickname to server
        updateNicknameOnServer(savedNickname);
    }
    
    // Load saved connections
    loadSavedConnections();
    
    // Load initial config
    fetch('/config')
        .then(response => response.json())
        .then(data => {
            localPortInfo.textContent = `Votre port UDP local: ${data.local_port}`;
            
            if (data.dest_ip && data.dest_port) {
                destIpInput.value = data.dest_ip;
                destPortInput.value = data.dest_port;
                enableChat();
                
                // Set current peer
                currentPeer = `${data.dest_ip}:${data.dest_port}`;
                currentPeerElement.textContent = `Connecté à: ${currentPeer}`;
                
                // Load conversation history for this peer
                loadConversationHistory(currentPeer);
            }
        })
        .catch(error => {
            showError("Échec du chargement de la configuration");
            console.error('Error:', error);
        });
    
    // Save nickname
    saveNicknameBtn.addEventListener('click', function() {
        const nickname = nicknameInput.value.trim();
        if (nickname) {
            localStorage.setItem('nickname', nickname);
            updateNicknameOnServer(nickname);
            showSuccess(`Pseudo enregistré: ${nickname}`);
        } else {
            showError("Veuillez entrer un pseudo valide");
        }
    });
    
    // Connect to discovered peer
    connectToPeerBtn.addEventListener('click', function() {
        const selectedPeerId = peersDropdown.value;
        if (selectedPeerId && discoveredPeers[selectedPeerId]) {
            const peer = discoveredPeers[selectedPeerId];
            destIpInput.value = peer.ip;
            destPortInput.value = peer.port;
            connectToPeer(peer.ip, peer.port);
        } else {
            showError("Veuillez sélectionner un pair pour vous connecter");
        }
    });
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to WebSocket server');
    });
    
    socket.on('connection_status', (data) => {
        localPortInfo.textContent = `Votre port UDP local: ${data.local_port}`;
    });
    
    socket.on('peers_updated', (data) => {
        discoveredPeers = data.peers;
        updatePeersDropdown();
    });
    
    socket.on('receive_message', (data) => {
        const messageObj = {
            type: 'received',
            sender: data.sender,
            content: data.message,
            timestamp: new Date(data.timestamp * 1000).toISOString()
        };
        
        addMessage(messageObj);
        
        // Save to conversation history
        if (currentPeer) {
            saveMessageToHistory(currentPeer, messageObj);
        }
        
        scrollToBottom();
    });
    
    socket.on('message_sent', (data) => {
        const messageObj = {
            type: 'sent',
            sender: getNickname(),
            content: data.message,
            timestamp: new Date(data.timestamp * 1000).toISOString()
        };
        
        addMessage(messageObj);
        
        // Save to conversation history
        if (currentPeer) {
            saveMessageToHistory(currentPeer, messageObj);
        }
        
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
            showError('Veuillez entrer l\'IP et le port de destination');
            return;
        }
        
        connectToPeer(destIp, destPort);
    });
    
    messageForm.addEventListener('submit', function(event) {
        event.preventDefault();
        
        const messageText = messageInput.value.trim();
        if (!messageText) return;
        
        socket.emit('send_message', { message: messageText });
    });
    
    // Load saved connection
    loadConnectionBtn.addEventListener('click', function() {
        const selectedOption = savedConnectionsList.options[savedConnectionsList.selectedIndex];
        if (selectedOption.value) {
            const [ip, port] = selectedOption.value.split(':');
            destIpInput.value = ip;
            destPortInput.value = port;
            connectToPeer(ip, port);
        }
    });
    
    // Delete saved connection
    deleteConnectionBtn.addEventListener('click', function() {
        const selectedOption = savedConnectionsList.options[savedConnectionsList.selectedIndex];
        if (selectedOption.value) {
            // Get saved connections
            const savedConnections = JSON.parse(localStorage.getItem('savedConnections') || '[]');
            
            // Filter out the selected connection
            const filteredConnections = savedConnections.filter(conn => conn !== selectedOption.value);
            
            // Save updated connections
            localStorage.setItem('savedConnections', JSON.stringify(filteredConnections));
            
            // Remove conversation history for this peer
            localStorage.removeItem(`chat_history_${selectedOption.value}`);
            
            // Reload the dropdown
            loadSavedConnections();
            
            showSuccess(`Connexion supprimée: ${selectedOption.value}`);
        }
    });
    
    // Helper functions
    function updatePeersDropdown() {
        // Clear the dropdown
        while (peersDropdown.options.length > 0) {
            peersDropdown.remove(0);
        }
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Sélectionner un pair découvert';
        peersDropdown.appendChild(defaultOption);
        
        // Add discovered peers
        Object.keys(discoveredPeers).forEach(peerId => {
            const peer = discoveredPeers[peerId];
            const option = document.createElement('option');
            option.value = peerId;
            option.textContent = `${peer.nickname} (${peerId})`;
            peersDropdown.appendChild(option);
        });
    }
    
    function updateNicknameOnServer(nickname) {
        fetch('/set_nickname', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                nickname: nickname
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log(`Pseudo défini: ${data.nickname}`);
            }
        })
        .catch(error => {
            console.error('Erreur lors de la définition du pseudo:', error);
        });
    }
    
    function connectToPeer(ip, port) {
        fetch('/connect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ip: ip,
                port: parseInt(port)
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                enableChat();
                showSuccess(`Connecté à ${ip}:${port}`);
                
                // Set current peer
                currentPeer = `${ip}:${port}`;
                currentPeerElement.textContent = `Connecté à: ${currentPeer}`;
                
                // Find nickname if it's a discovered peer
                if (discoveredPeers[currentPeer]) {
                    const peerNickname = discoveredPeers[currentPeer].nickname;
                    currentPeerElement.textContent = `Connecté à: ${peerNickname} (${currentPeer})`;
                }
                
                // Save this connection
                saveConnection(ip, port);
                
                // Load conversation history
                loadConversationHistory(currentPeer);
            } else {
                showError(data.message || 'Échec de la connexion');
            }
        })
        .catch(error => {
            showError('Échec de la connexion');
            console.error('Error:', error);
        });
    }
    
    function showError(message) {
        errorBanner.textContent = message;
        errorBanner.style.backgroundColor = '#ffdddd';
        errorBanner.style.color = '#ff0000';
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
    
    function addMessage(messageObj) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${messageObj.type}`;
        
        if (messageObj.sender && messageObj.type === 'received') {
            const senderDiv = document.createElement('div');
            senderDiv.className = 'message-sender';
            
            // Try to find peer nickname if it's from a discovered peer
            let displayName = messageObj.sender;
            const peerId = messageObj.sender;
            if (discoveredPeers[peerId]) {
                displayName = `${discoveredPeers[peerId].nickname} (${peerId})`;
            }
            
            senderDiv.textContent = displayName;
            messageDiv.appendChild(senderDiv);
        } else if (messageObj.sender && messageObj.type === 'sent') {
            const senderDiv = document.createElement('div');
            senderDiv.className = 'message-sender';
            senderDiv.textContent = 'Vous';
            messageDiv.appendChild(senderDiv);
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = messageObj.content;
        messageDiv.appendChild(contentDiv);
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = formatTime(new Date(messageObj.timestamp));
        messageDiv.appendChild(timeDiv);
        
        messagesContainer.appendChild(messageDiv);
    }
    
    function formatTime(date) {
        return date.toLocaleTimeString();
    }
    
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function getNickname() {
        return nicknameInput.value.trim() || 'Anonymous';
    }
    
    function saveConnection(ip, port) {
        const connectionString = `${ip}:${port}`;
        
        // Get saved connections
        const savedConnections = JSON.parse(localStorage.getItem('savedConnections') || '[]');
        
        // Add if not exists
        if (!savedConnections.includes(connectionString)) {
            savedConnections.push(connectionString);
            localStorage.setItem('savedConnections', JSON.stringify(savedConnections));
            
            // Reload the dropdown
            loadSavedConnections();
        }
    }
    
    function loadSavedConnections() {
        // Clear existing options except the first one
        while (savedConnectionsList.options.length > 1) {
            savedConnectionsList.remove(1);
        }
        
        // Get saved connections
        const savedConnections = JSON.parse(localStorage.getItem('savedConnections') || '[]');
        
        // Add to dropdown
        savedConnections.forEach(conn => {
            const option = document.createElement('option');
            option.value = conn;
            option.textContent = conn;
            savedConnectionsList.appendChild(option);
        });
    }
    
    function saveMessageToHistory(peer, messageObj) {
        // Get existing history
        const history = JSON.parse(localStorage.getItem(`chat_history_${peer}`) || '[]');
        
        // Add new message
        history.push(messageObj);
        
        // Save back to localStorage
        localStorage.setItem(`chat_history_${peer}`, JSON.stringify(history));
    }
    
    function loadConversationHistory(peer) {
        // Clear current messages
        messagesContainer.innerHTML = '';
        
        // Get history for this peer
        const history = JSON.parse(localStorage.getItem(`chat_history_${peer}`) || '[]');
        
        // Add messages to container
        history.forEach(messageObj => {
            addMessage(messageObj);
        });
        
        // Scroll to bottom
        scrollToBottom();
    }
});