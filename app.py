import os
import socket
import select
import threading
import time
import sys
import json
import subprocess
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

# UDP socket setup
udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp_socket.bind(('0.0.0.0', 0))  # Use any available port
udp_socket.setblocking(False)
local_port = udp_socket.getsockname()[1]

# Store destination information
dest_info = {
    'ip': None,
    'port': None
}

# Store discovered IPs
discovered_ips = {}
# Store local nickname
local_nickname = "Anonymous"

# Initialize epoll for UDP socket
epoll = select.epoll()
epoll.register(udp_socket.fileno(), select.EPOLLIN)  # Listen for messages

def get_network_info():
    """Get local IP and subnet information"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Connect to an external server (doesn't actually establish a connection)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        
        # Parse the subnet
        ip_parts = local_ip.split('.')
        subnet_prefix = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}"
        
        return local_ip, subnet_prefix
    except Exception as e:
        print(f"Error getting network info: {e}")
        return "127.0.0.1", "127.0.0"

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
    while True:
        try:
            events = epoll.poll(timeout=1)  # Use timeout to avoid blocking indefinitely
            
            for fileno, event in events:
                if fileno == udp_socket.fileno():  # Message received
                    data, addr = udp_socket.recvfrom(2048)
                    try:
                        message = dechiffrer(data)
                        # Try to parse as JSON
                        try:
                            message_data = json.loads(message)
                            # Si c'est un message de test, ne pas l'afficher à l'utilisateur
                            if message_data.get('test', False):
                                continue
                                
                            content = message_data.get('content', message)  # Fallback to using the entire message
                            socketio.emit('receive_message', {
                                'sender': f"{addr[0]}:{addr[1]}",
                                'message': content,
                                'timestamp': time.time()
                            })
                        except json.JSONDecodeError:
                            # Not JSON, treat as plain message
                            socketio.emit('receive_message', {
                                'sender': f"{addr[0]}:{addr[1]}",
                                'message': message,
                                'timestamp': time.time()
                            })
                    except Exception as e:
                        print(f"\n[Erreur] Impossible de traiter le message: {e}")
                        socketio.emit('error', {'message': 'Failed to process incoming message'})
        except Exception as e:
            print(f"Error in UDP listener: {e}")
            time.sleep(1)  # Avoid CPU spinning on persistent errors

def ping_host(ip):
    """Ping an IP address to check if it's online"""
    try:
        # Different ping command based on OS
        if sys.platform.lower() == "win32":
            ping_cmd = ["ping", "-n", "1", "-w", "100", ip]
        else:
            ping_cmd = ["ping", "-c", "1", "-W", "1", ip]
            
        # Run the command and suppress output
        result = subprocess.run(ping_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.returncode == 0
    except:
        return False

def scan_network():
    """Thread function to scan the network for active IPs"""
    global discovered_ips
    
    # Get network information
    local_ip, subnet_prefix = get_network_info()
    print(f"Local IP: {local_ip}, Subnet: {subnet_prefix}")
    
    while True:
        active_ips = {}
        
        # Add our own IP first
        active_ips[local_ip] = {
            'hostname': 'This device',
            'last_seen': time.time()
        }
        
        # Scan the network using ping
        print(f"Starting network scan on {subnet_prefix}.0/24...")
        for i in range(1, 255):
            target_ip = f"{subnet_prefix}.{i}"
            
            # Skip our own IP (already added)
            if target_ip == local_ip:
                continue
                
            if ping_host(target_ip):
                try:
                    # Try to get hostname (with timeout)
                    hostname = socket.getfqdn(target_ip)
                    if hostname == target_ip:  # If hostname is the same as IP
                        hostname = "Unknown"
                except:
                    hostname = "Unknown"
                
                active_ips[target_ip] = {
                    'hostname': hostname,
                    'last_seen': time.time()
                }
                print(f"Found active host: {target_ip} ({hostname})")
        
        # Update discovered IPs
        discovered_ips = active_ips
        socketio.emit('ips_updated', {'ips': discovered_ips})
        
        print(f"Network scan completed, {len(discovered_ips)} hosts found")
        
        # Sleep before next scan
        time.sleep(15)  # Scan every 15 seconds

def check_connection_status():
    """Thread function to periodically check if destination is reachable"""
    global dest_info
    
    while True:
        if dest_info['ip'] and dest_info['port']:
            if not ping_host(dest_info['ip']):
                socketio.emit('connection_warning', {
                    'message': f"Attention: L'hôte {dest_info['ip']} semble inaccessible."
                })
        
        # Vérifier toutes les 30 secondes
        time.sleep(30)

# Start the UDP listener thread
udp_thread = threading.Thread(target=udp_listener, daemon=True)
udp_thread.start()

# Start the network scanning thread
scan_thread = threading.Thread(target=scan_network, daemon=True)
scan_thread.start()

# Démarrer le thread de surveillance de connexion
conn_check_thread = threading.Thread(target=check_connection_status, daemon=True)
conn_check_thread.start()

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

@app.route('/active_ips', methods=['GET'])
def get_active_ips():
    """Get the list of discovered active IPs"""
    return jsonify({
        'ips': discovered_ips
    })

@app.route('/connect', methods=['POST'])
def set_destination():
    """Set the destination IP and port"""
    data = request.json
    ip = data.get('ip')
    port = data.get('port')
    
    # Validation de l'adresse IP
    try:
        socket.inet_aton(ip)  # Vérifie que l'IP est au format correct
    except socket.error:
        return jsonify({'success': False, 'message': 'Adresse IP invalide'})
    
    # Validation du port
    if not isinstance(port, int) or port < 1 or port > 65535:
        return jsonify({'success': False, 'message': 'Port invalide. Doit être un nombre entre 1 et 65535'})
    
    # Test de connectivité
    if not ping_host(ip):
        return jsonify({'success': False, 'message': f"Impossible de joindre l'hôte {ip}. Vérifiez que l'appareil est connecté au réseau."})
    
    # Essayer d'envoyer un message de test
    test_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    test_socket.settimeout(2)  # Timeout de 2 secondes
    
    try:
        # Essayer d'envoyer un message de test
        test_message = chiffrer(json.dumps({"test": True, "sender": local_nickname}))
        test_socket.sendto(test_message, (ip, port))
        
    except socket.error as e:
        test_socket.close()
        return jsonify({'success': False, 'message': f"Erreur de connexion: {str(e)}"})
        
    test_socket.close()
    
    dest_info['ip'] = ip
    dest_info['port'] = port
    return jsonify({'success': True, 'message': f"Connecté à {dest_info['ip']}:{dest_info['port']}"})

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
    # Send current discovered IPs to newly connected client
    emit('ips_updated', {'ips': discovered_ips})

@socketio.on('send_message')
def handle_message(data):
    """Handle sending a message via UDP"""
    if not dest_info['ip'] or not dest_info['port']:
        emit('error', {'message': 'Destination non configurée'})
        return

    message = data.get('message', '')
    try:
        # Try to format as a JSON message for better compatibility
        message_data = {
            'content': message,
            'sender': local_nickname,
            'timestamp': time.time()
        }
        message_json = json.dumps(message_data)
        encrypted_data = chiffrer(message_json)
        
        # Essayer d'envoyer le message avec un timeout
        try:
            # Vérifier d'abord si l'hôte est joignable
            if not ping_host(dest_info['ip']):
                emit('error', {'message': f"IP ou port invalide : L'hôte {dest_info['ip']} est inaccessible. Le message n'a pas été envoyé."})
                return
                
            # Créer un socket temporaire avec timeout pour l'envoi
            temp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            temp_socket.settimeout(2)  # 2 secondes de timeout
            
            temp_socket.sendto(encrypted_data, (dest_info['ip'], dest_info['port']))
            temp_socket.close()
            
            # Le message a été envoyé avec succès (du moins, pas d'erreur détectée)
            emit('message_sent', {'success': True, 'message': message, 'timestamp': time.time()})
                
        except socket.timeout:
            emit('error', {'message': f"IP ou port invalide : Délai d'attente dépassé lors de l'envoi du message."})
        except socket.error as e:
            emit('error', {'message': f"IP ou port invalide : {str(e)}"})
            
    except Exception as e:
        print(f"Error sending message: {e}")
        emit('error', {'message': f'Échec de l\'envoi du message: {str(e)}'})

if __name__ == '__main__':
    print(f"Starting server. Local UDP port: {local_port}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)