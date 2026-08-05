const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'private-chat-e2ee-secret-2026';
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/private-chat';

// Configure Cloudinary if credentials exist
const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;
if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// ================= MONGOOSE SCHEMAS & MODELS =================
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  public_key: { type: String, default: '' }
}, { timestamps: true });

userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.password;
    return ret;
  }
});

const friendSchema = new mongoose.Schema({
  requester_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted'], default: 'pending' }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  iv: { type: String, default: '' },
  media_url: { type: String, default: null },
  timestamp: { type: Date, default: Date.now }
});

messageSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString();
    ret.sender_id = ret.sender_id.toString();
    ret.receiver_id = ret.receiver_id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);
const Friend = mongoose.model('Friend', friendSchema);
const Message = mongoose.model('Message', messageSchema);

// MongoDB Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB database successfully.'))
  .catch(err => console.error('MongoDB connection error:', err));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// JWT Verification Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// REST Endpoints
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const existingUser = await User.findOne({ username: username.trim() });
    if (existingUser) return res.status(400).json({ error: 'Username already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      username: username.trim(),
      password: hashedPassword,
      public_key: publicKey || ''
    });

    const userObj = newUser.toJSON();
    const token = jwt.sign({ id: userObj.id, username: userObj.username }, JWT_SECRET);
    res.json({ token, user: userObj });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;
    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    if (publicKey) {
      user.public_key = publicKey;
      await user.save();
    }

    const userObj = user.toJSON();
    const token = jwt.sign({ id: userObj.id, username: userObj.username }, JWT_SECRET);
    res.json({ token, user: userObj });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);

    const users = await User.find({
      username: { $regex: query, $options: 'i' },
      _id: { $ne: req.user.id }
    }).limit(10);

    const formattedUsers = await Promise.all(users.map(async (u) => {
      const friendship = await Friend.findOne({
        $or: [
          { requester_id: req.user.id, receiver_id: u._id },
          { requester_id: u._id, receiver_id: req.user.id }
        ]
      });

      return {
        id: u._id.toString(),
        username: u.username,
        public_key: u.public_key,
        friend_status: friendship ? friendship.status : null
      };
    }));

    res.json(formattedUsers);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/friends', authenticateToken, async (req, res) => {
  try {
    const friendships = await Friend.find({
      $or: [
        { requester_id: req.user.id },
        { receiver_id: req.user.id }
      ]
    }).populate('requester_id receiver_id');

    const friends = friendships.map(f => {
      const isRequester = f.requester_id._id.toString() === req.user.id;
      const targetUser = isRequester ? f.receiver_id : f.requester_id;

      return {
        id: targetUser._id.toString(),
        username: targetUser.username,
        public_key: targetUser.public_key,
        status: f.status,
        requester_id: f.requester_id._id.toString()
      };
    });

    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/upload', authenticateToken, upload.single('media'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  if (useCloudinary) {
    try {
      const result = await cloudinary.uploader.upload(req.file.path, { resource_type: 'auto' });
      fs.unlinkSync(req.file.path);
      return res.json({ mediaUrl: result.secure_url });
    } catch (err) {
      return res.status(500).json({ error: 'Cloud upload failed' });
    }
  }

  res.json({ mediaUrl: `/uploads/${req.file.filename}` });
});

app.get('/api/messages/:friendId', authenticateToken, async (req, res) => {
  try {
    const friendId = req.params.friendId;
    const messages = await Message.find({
      $or: [
        { sender_id: req.user.id, receiver_id: friendId },
        { sender_id: friendId, receiver_id: req.user.id }
      ]
    }).sort({ timestamp: 1 });

    res.json(messages.map(m => m.toJSON()));
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Socket.io Realtime Layer
const activeSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  activeSockets.set(userId, socket.id);
  io.emit('user_status', { userId, status: 'online' });

  // Friend Requests
  socket.on('send_friend_request', async ({ targetUserId }) => {
    try {
      const existing = await Friend.findOne({
        $or: [
          { requester_id: userId, receiver_id: targetUserId },
          { requester_id: targetUserId, receiver_id: userId }
        ]
      });

      if (!existing) {
        await Friend.create({ requester_id: userId, receiver_id: targetUserId, status: 'pending' });
        const targetSocket = activeSockets.get(targetUserId);
        if (targetSocket) {
          io.to(targetSocket).emit('friend_request_received', {
            id: userId,
            username: socket.user.username
          });
        }
      }
    } catch (err) {
      console.error('Friend request error:', err);
    }
  });

  socket.on('accept_friend_request', async ({ targetUserId }) => {
    try {
      await Friend.findOneAndUpdate(
        { requester_id: targetUserId, receiver_id: userId },
        { status: 'accepted' }
      );

      const targetSocket = activeSockets.get(targetUserId);
      if (targetSocket) {
        io.to(targetSocket).emit('friend_request_accepted', { userId });
      }
      socket.emit('friend_request_accepted', { userId: targetUserId });
    } catch (err) {
      console.error('Accept friend request error:', err);
    }
  });

  // E2EE Encrypted Messaging
  socket.on('send_message', async ({ receiverId, content, iv, mediaUrl }) => {
    try {
      const newMsg = await Message.create({
        sender_id: userId,
        receiver_id: receiverId,
        content: content || '',
        iv: iv || '',
        media_url: mediaUrl || null
      });

      const msgObj = newMsg.toJSON();

      const targetSocket = activeSockets.get(receiverId);
      if (targetSocket) {
        io.to(targetSocket).emit('new_message', msgObj);
      }
      socket.emit('message_sent', msgObj);
    } catch (err) {
      console.error('Send message error:', err);
    }
  });

  // WebRTC Signaling (Voice & Video Call)
  socket.on('call_user', ({ userToCall, signalData, isVideo }) => {
    const targetSocket = activeSockets.get(userToCall);
    if (targetSocket) {
      io.to(targetSocket).emit('incoming_call', {
        from: userId,
        fromUsername: socket.user.username,
        signal: signalData,
        isVideo
      });
    }
  });

  socket.on('answer_call', ({ to, signal }) => {
    const targetSocket = activeSockets.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('call_accepted', { signal });
    }
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    const targetSocket = activeSockets.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('ice_candidate', { candidate });
    }
  });

  socket.on('end_call', ({ to }) => {
    const targetSocket = activeSockets.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('call_ended');
    }
  });

  socket.on('disconnect', () => {
    activeSockets.delete(userId);
    io.emit('user_status', { userId, status: 'offline' });
  });
});

server.listen(PORT, () => console.log(`Private-Chat server running on port ${PORT}`));