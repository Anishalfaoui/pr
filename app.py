import os
import socket
import select
import threading
import time
import sys
import json
from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = 'yoursecretkey'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# AES encryption parameters
KEY = b"thisisaverysecretkey123N"  # 24 bytes

# UDP socket setup - configuration pour réception de messages normaux et discovery
udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp_socket.bind(('0.0.0.0', 0))  # Use any available port
udp_socket.setblocking(False)  # Non-blocking mode
local_port = udp_socket.getsockname()[1]

# Socket pour envoi de broadcasts
broadcast_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
broadcast_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

# Store destination information
dest_info = {
    'ip': None,
    'port': None
}

# Store discovered peers
discovered_peers = {}
# Store local nickname
local_nickname = "Anonymous"

# Initialize epoll for UDP socket
epoll = select.epoll()
epoll.register(udp_socket.fileno(), select.EPOLLIN)  # Listen for messages

def get_network_info():
    """Get local IP and subnet broadcast address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Connect to an external server (doesn't actually establish a connection)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        
        # Try to get subnet info (rough estimation)
        # Assuming a standard class C subnet mask 255.255.255.0 for simplicity
        ip_parts = local_ip.split('.')
        broadcast_ip = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.255"
        
        return local_ip, broadcast_ip
    except Exception as e:
        print(f"Error getting network info: {e}")
        return "127.0.0.1", "127.0.0.1"

def chiffrer(message):
    """Chiffre un message avec AES en mode CBC."""
    IV = os.urandom(16)  # Random IV generation as in original
    cipher = AES.new(KEY, AES.MODE_CBC, IV)
    return IV + cipher.encrypt(pad(message.encode(), AES.block_size))

def dechiffrer(data):
    """Déchiffre un message AES CBC."""
    iv = data[:16]  # Extract IV
    cipher = AES.new(KEY, AES.MODE_CBC, iv)
    return unpad(cipher.decrypt(data[16:]), AES.block_size).decode()

def udp_listener():
    """Thread function to monitor UDP socket using epoll"""
    local_ip, _ = get_network_info()
    
    while True:
        try:
            events = epoll.poll(timeout=1)  # Use timeout to avoid blocking indefinitely
            
            for fileno, event in events:
                if fileno == udp_socket.fileno():  # Message received
                    data, addr = udp_socket.recvfrom(2048)
                    try:
                        message = dechiffrer(data)
                        message_data = json.loads(message)
                        
                        # Check if it's a discovery message
                        if message_data.get('type') == 'discovery':
                            # Skip our own broadcasts
                            if addr[0] == local_ip and message_data.get('port') == local_port:
                                continue
                                
                            peer_id = f"{addr[0]}:{message_data.get('port')}"
                            discovered_peers[peer_id] = {
                                'ip': addr[0],
                                'port': message_data.get('port'),
                                'nickname': message_data.get('nickname', 'Anonymous'),
                                'last_seen': time.time()
                            }
                            print(f"Discovered peer: {peer_id} ({message_data.get('nickname', 'Anonymous')})")
                            # Emit update to clients
                            socketio.emit('peers_updated', {'peers': discovered_peers})
                        else:
                            # Normal chat message
                            socketio.emit('receive_message', {
                                'sender': f"{addr[0]}:{addr[1]}",
                                'message': message_data.get('content', ''),
                                'timestamp': time.time()
                            })
                    except Exception as e:
                        print(f"\n[Erreur] Impossible de traiter le message: {e}")
                        socketio.emit('error', {'message': 'Failed to process incoming message'})
        except Exception as e:
            print(f"Error in UDP listener: {e}")
            time.sleep(1)  # Avoid CPU spinning on persistent errors

def broadcast_discovery():
    """Thread function to broadcast discovery messages every 5 seconds"""
    global local_nickname, discovered_peers
    
    # Get network information
    local_ip, broadcast_ip = get_network_info()
    print(f"Local IP: {local_ip}, Broadcast IP: {broadcast_ip}")
    
    while True:
        try:
            # Send discovery broadcast to each active port we know about,
            # plus a broadcast to a range of common ports
            discovery_data = {
                'type': 'discovery',
                'port': local_port,
                'nickname': local_nickname,
                'timestamp': time.time()
            }
            
            discovery_json = json.dumps(discovery_data)
            encrypted_discovery = chiffrer(discovery_json)
            
            # Send to all peers we've discovered (their original ports)
            for peer_id, peer_info in discovered_peers.items():
                try:
                    peer_ip = peer_info['ip']
                    peer_port = peer_info['port']
                    broadcast_socket.sendto(encrypted_discovery, (peer_ip, int(peer_port)))
                except Exception as e:
                    print(f"Error sending to known peer {peer_id}: {e}")
            
            # Also send to broadcast address for new peers
            # This will be received by anyone listening on any port
            try:
                broadcast_socket.sendto(encrypted_discovery, (broadcast_ip, local_port))
                # Broadcast to a few common ports to increase discovery chances
                for port in [1024, 5000, 8000, 9000, 12345, 50000]:
                    if port != local_port:  # Don't send to our own port
                        broadcast_socket.sendto(encrypted_discovery, (broadcast_ip, port))
                print(f"Sent discovery broadcast to {broadcast_ip}")
            except Exception as e:
                print(f"Error sending broadcast: {e}")
            
            # Clean up old peers (not seen in the last 15 seconds)
            current_time = time.time()
            peers_to_remove = []
            
            for peer_id, peer_info in discovered_peers.items():
                if current_time - peer_info['last_seen'] > 15:
                    peers_to_remove.append(peer_id)
            
            if peers_to_remove:
                for peer_id in peers_to_remove:
                    del discovered_peers[peer_id]
                    print(f"Removed inactive peer: {peer_id}")
                socketio.emit('peers_updated', {'peers': discovered_peers})
            
            # Sleep for 5 seconds before next broadcast
            time.sleep(5)
            
        except Exception as e:
            print(f"Error in broadcast discovery: {e}")
            time.sleep(5)  # Retry after 5 seconds

# Start the UDP listener thread
udp_thread = threading.Thread(target=udp_listener, daemon=True)
udp_thread.start()

# Start the broadcast discovery thread
broadcast_thread = threading.Thread(target=broadcast_discovery, daemon=True)
broadcast_thread.start()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/config', methods=['GET'])
def get_config():
    """Get the local UDP port"""
    return jsonify({
        'local_port': local_port,
        'dest_ip': dest_info['ip'],
        'dest_port': dest_info['port']
    })

@app.route('/peers', methods=['GET'])
def get_peers():
    """Get the list of discovered peers"""
    return jsonify({
        'peers': discovered_peers
    })

@app.route('/connect', methods=['POST'])
def set_destination():
    """Set the destination IP and port"""
    data = request.json
    dest_info['ip'] = data.get('ip')
    dest_info['port'] = int(data.get('port'))
    return jsonify({'success': True, 'message': f"Connected to {dest_info['ip']}:{dest_info['port']}"})

@app.route('/set_nickname', methods=['POST'])
def set_nickname():
    """Set the local nickname"""
    global local_nickname
    data = request.json
    local_nickname = data.get('nickname', 'Anonymous')
    return jsonify({'success': True, 'nickname': local_nickname})

@socketio.on('connect')
def handle_connect():
    emit('connection_status', {'status': 'connected', 'local_port': local_port})
    # Send current peers list to newly connected client
    emit('peers_updated', {'peers': discovered_peers})

@socketio.on('send_message')
def handle_message(data):
    """Handle sending a message via UDP"""
    if not dest_info['ip'] or not dest_info['port']:
        emit('error', {'message': 'Destination not set'})
        return

    message = data.get('message', '')
    try:
        message_data = {
            'content': message,
            'sender': local_nickname,
            'timestamp': time.time()
        }
        message_json = json.dumps(message_data)
        encrypted_data = chiffrer(message_json)
        udp_socket.sendto(encrypted_data, (dest_info['ip'], dest_info['port']))
        emit('message_sent', {'success': True, 'message': message, 'timestamp': time.time()})
    except Exception as e:
        print(f"Error sending message: {e}")
        emit('error', {'message': f'Failed to send message: {str(e)}'})

if __name__ == '__main__':
    print(f"Starting server. Local UDP port: {local_port}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)