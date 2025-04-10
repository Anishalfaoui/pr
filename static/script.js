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
    const activeIpsDropdown = document.getElementById('active-ips');
    const selectIpBtn = document.getElementById('select-ip-btn');
    
    // Connection state
    let isConnected = false;
    let currentPeer = null;
    let discoveredIps = {};
    
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
    
    // Initial load of active IPs
    loadActiveIps();
    
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
    
    // Select IP from dropdown
    selectIpBtn.addEventListener('click', function() {
        const selectedIp = activeIpsDropdown.value;
        if (selectedIp) {
            destIpInput.value = selectedIp;
            // Focus on port input for user to enter
            destPortInput.focus();
            showSuccess(`IP sélectionnée: ${selectedIp}. Veuillez entrer le port.`);
        } else {
            showError("Veuillez sélectionner une adresse IP");
        }
    });
    
    // Socket event handlers
    socket.on('connect', () => {
        console.log('Connected to WebSocket server');
    });
    
    socket.on('connection_status', (data) => {
        localPortInfo.textContent = `Votre port UDP local: ${data.local_port}`;
    });
    
    socket.on('ips_updated', (data) => {
        discoveredIps = data.ips;
        updateIpsDropdown();
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
    
    socket.on('connection_warning', (data) => {
        showWarning(data.message);
    });
    
    // Fonction pour valider une adresse IP
    function isValidIP(ip) {
        // Regex pour valider une adresse IPv4
        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        return ipRegex.test(ip);
    }

    // Fonction pour valider un port
    function isValidPort(port) {
        const portNum = parseInt(port);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }
    
    // Form submit event handlers
    connectionForm.addEventListener('submit', function(event) {
        event.preventDefault();
        
        const destIp = destIpInput.value.trim();
        const destPort = destPortInput.value.trim();
        
        if (!destIp || !destPort) {
            showError('Veuillez entrer l\'IP et le port de destination');
            return;
        }
        
        // Validation du format
        if (!isValidIP(destIp)) {
            showError('Adresse IP invalide. Veuillez saisir une adresse IPv4 valide (ex: 192.168.1.1)');
            destIpInput.classList.add('input-error');
            return;
        } else {
            destIpInput.classList.remove('input-error');
        }
        
        if (!isValidPort(destPort)) {
            showError('Port invalide. Veuillez saisir un port entre 1 et 65535');
            destPortInput.classList.add('input-error');
            return;
        } else {
            destPortInput.classList.remove('input-error');
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
    function loadActiveIps() {
        fetch('/active_ips')
            .then(response => response.json())
            .then(data => {
                discoveredIps = data.ips;
                updateIpsDropdown();
            })
            .catch(error => {
                console.error('Error loading active IPs:', error);
            });
    }
    
    function updateIpsDropdown() {
        // Clear the dropdown
        while (activeIpsDropdown.options.length > 0) {
            activeIpsDropdown.remove(0);
        }
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Sélectionner une adresse IP active';
        activeIpsDropdown.appendChild(defaultOption);
        
        // Add discovered IPs
        Object.keys(discoveredIps).forEach(ip => {
            const ipInfo = discoveredIps[ip];
            const option = document.createElement('option');
            option.value = ip;
            option.textContent = `${ip} (${ipInfo.hostname})`;
            activeIpsDropdown.appendChild(option);
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
        // Réinitialiser les classes d'erreur
        destIpInput.classList.remove('input-error');
        destPortInput.classList.remove('input-error');
        
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
                
                // Set hostname if available
                let displayName = currentPeer;
                if (discoveredIps[ip] && discoveredIps[ip].hostname !== "Unknown") {
                    displayName = `${discoveredIps[ip].hostname} (${currentPeer})`;
                }
                currentPeerElement.textContent = `Connecté à: ${displayName}`;
                
                // Save this connection
                saveConnection(ip, port);
                
                // Load conversation history
                loadConversationHistory(currentPeer);
            } else {
                showError(data.message || 'Échec de la connexion');
                
                // Mettre en évidence les champs problématiques
                if (data.message && data.message.includes('IP')) {
                    destIpInput.classList.add('input-error');
                }
                if (data.message && data.message.includes('Port')) {
                    destPortInput.classList.add('input-error');
                }
            }
        })
        .catch(error => {
            showError('Échec de la connexion au serveur');
            console.error('Error:', error);
        });
    }
    
    function showError(message) {
        errorBanner.textContent = message;
        errorBanner.style.backgroundColor = '#ffdddd';
        errorBanner.style.color = '#721c24';
        errorBanner.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            errorBanner.style.display = 'none';
        }, 5000);
    }
    
    function showWarning(message) {
        errorBanner.textContent = message;
        errorBanner.style.backgroundColor = '#fff3cd';
        errorBanner.style.color = '#856404';
        errorBanner.style.display = 'block';
        
        // Masquer après 5 secondes
        setTimeout(() => {
            errorBanner.style.display = 'none';
        }, 5000);
    }
    
    function showSuccess(message) {
        errorBanner.textContent = message;
        errorBanner.style.backgroundColor = '#ddffdd';
        errorBanner.style.color = '#155724';
        errorBanner.style.display = 'block';
        
        // Hide after 5 seconds
        setTimeout(() => {
            errorBanner.style.display = 'none';
        }, 5000);
    }
    
    function enableChat() {
        isConnected = true;
        messageInput.disabled = false;
        sendButton.disabled = false;
    }
    
    function addMessage(messageObj) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${messageObj.type}`;
        
        const senderElement = document.createElement('div');
        senderElement.className = 'sender';
        senderElement.textContent = messageObj.sender;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'content';
        contentElement.textContent = messageObj.content;
        
        const timeElement = document.createElement('div');
        timeElement.className = 'timestamp';
        timeElement.textContent = new Date(messageObj.timestamp).toLocaleTimeString();
        
        messageElement.appendChild(senderElement);
        messageElement.appendChild(contentElement);
        messageElement.appendChild(timeElement);
        
        messagesContainer.appendChild(messageElement);
    }
    
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    function saveConnection(ip, port) {
        const connectionString = `${ip}:${port}`;
        
        // Get saved connections
        let savedConnections = JSON.parse(localStorage.getItem('savedConnections') || '[]');
        
        // Check if this connection is already saved
        if (!savedConnections.includes(connectionString)) {
            savedConnections.push(connectionString);
            localStorage.setItem('savedConnections', JSON.stringify(savedConnections));
            
            // Update the dropdown
            loadSavedConnections();
        }
    }
    
    function loadSavedConnections() {
        // Clear the dropdown
        while (savedConnectionsList.options.length > 0) {
            savedConnectionsList.remove(0);
        }
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Sélectionner une connexion sauvegardée';
        savedConnectionsList.appendChild(defaultOption);
        
        // Get saved connections
        const savedConnections = JSON.parse(localStorage.getItem('savedConnections') || '[]');
        
        // Add options for each saved connection
        savedConnections.forEach(conn => {
            const option = document.createElement('option');
            option.value = conn;
            option.textContent = conn;
            savedConnectionsList.appendChild(option);
        });
    }
    
    function saveMessageToHistory(peer, messageObj) {
        // Get existing history
        let history = JSON.parse(localStorage.getItem(`chat_history_${peer}`) || '[]');
        
        // Add new message
        history.push(messageObj);
        
        // Save back to localStorage (limit to 100 messages)
        if (history.length > 100) {
            history = history.slice(history.length - 100);
        }
        localStorage.setItem(`chat_history_${peer}`, JSON.stringify(history));
    }
    
    function loadConversationHistory(peer) {
        // Clear messages container
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
    
    function getNickname() {
        return nicknameInput.value.trim() || 'Anonymous';
    }
});