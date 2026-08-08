# NO-TRACE Messaging App-v2.0
NO_TRACE is a real-time, end-to-end encrypted (E2EE) messaging web application featuring WebRTC 1-on-1 voice/video calls, media sharing, and friend management built with Node.js, Socket.io, SQLite, and Web Crypto API.

Core Stack: Node.js, Express, Socket.io, MongoDB Atlas, and Tailwind CSS.

Security: Implements the Web Crypto API (ECDH & AES-GCM algorithms) for true End-to-End Encryption (E2EE), ensuring the server never has access to private keys or plaintext messages.

WebRTC Integration: Features direct, low-latency peer-to-peer audio and video calling through WebRTC, utilizing dynamic STUN servers for seamless network traversal.

Project Disclaimer & Technical Limitations
Development Status
This application is a continuous portfolio project developed by WhiteHatPanda to demonstrate full-stack software engineering, real-time socket communication, and cryptographic implementation. While fully functional, it is designed for educational and demonstration purposes rather than mission-critical or highly sensitive production use.

End-to-End Encryption (E2EE) Architecture
Messages are secured using true End-to-End Encryption. Because cryptographic private keys are generated and stored exclusively within the local storage of the device's browser, chat history cannot currently be synchronized across multiple devices or different browsers. Clearing your browser data will result in the permanent loss of message decryption capabilities for past conversations.

Voice & Video Calling (WebRTC)
The real-time calling feature utilizes STUN servers for direct Peer-to-Peer (P2P) connections. If users attempt to connect while behind strict network environments—such as corporate firewalls, VPNs, or certain mobile data carriers utilizing Symmetric NAT—the call may fail to establish and remain on "Connecting." This is a known network traversal constraint, as a TURN relay server has been intentionally omitted from this build to prioritize direct P2P connections.
