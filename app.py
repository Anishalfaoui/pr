import os
import socket
import select
import threading
import time
from flask import Flask, request, jsonify, render_template, send_from_directory
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
udp_socket.bind(('0.0.0.0', 0))  # Use any available port
local_port = udp_socket.getsockname()[1]

# Store destination information
dest_info = {
    'ip': None,
    'port': None
}

def chiffrer(message):
    """Encrypts a message with AES in CBC mode."""
    IV = os.urandom(16)
    cipher = AES.new(KEY, AES.MODE_CBC, IV)
    return IV + cipher.encrypt(pad(message.encode(), AES.block_size))

def dechiffrer(data):
    """Decrypts an AES CBC message."""
    iv = data[:16]
    cipher = AES.new(KEY, AES.MODE_CBC, iv)
    return unpad(cipher.decrypt(data[16:]), AES.block_size).decode()

def udp_listener():
    """Thread function to listen for UDP messages"""
    while True:
        try:
            # Set a timeout to avoid blocking indefinitely
            udp_socket.settimeout(1)
            data, addr = udp_socket.recvfrom(1024)
            
            try:
                message = dechiffrer(data)
                # Send the message to all connected clients via WebSocket
                socketio.emit('receive_message', {
                    'sender': f"{addr[0]}:{addr[1]}",
                    'message': message,
                    'timestamp': time.time()
                })
            except Exception as e:
                print(f"Error decrypting message: {e}")
                socketio.emit('error', {'message': 'Failed to decrypt incoming message'})
        except socket.timeout:
            # This is expected, just continue the loop
            pass
        except Exception as e:
            print(f"Error in UDP listener: {e}")
            time.sleep(1)  # Avoid CPU spinning on persistent errors

# Start the UDP listener thread
udp_thread = threading.Thread(target=udp_listener, daemon=True)
udp_thread.start()

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

@app.route('/connect', methods=['POST'])
def set_destination():
    """Set the destination IP and port"""
    data = request.json
    dest_info['ip'] = data.get('ip')
    dest_info['port'] = int(data.get('port'))
    return jsonify({'success': True, 'message': f"Connected to {dest_info['ip']}:{dest_info['port']}"})

@socketio.on('connect')
def handle_connect():
    emit('connection_status', {'status': 'connected', 'local_port': local_port})

@socketio.on('send_message')
def handle_message(data):
    """Handle sending a message via UDP"""
    if not dest_info['ip'] or not dest_info['port']:
        emit('error', {'message': 'Destination not set'})
        return

    message = data.get('message', '')
    try:
        encrypted_data = chiffrer(message)
        udp_socket.sendto(encrypted_data, (dest_info['ip'], dest_info['port']))
        emit('message_sent', {'success': True, 'message': message, 'timestamp': time.time()})
    except Exception as e:
        print(f"Error sending message: {e}")
        emit('error', {'message': f'Failed to send message: {str(e)}'})

if __name__ == '__main__':
    print(f"Starting server. Local UDP port: {local_port}")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)