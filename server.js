'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, uptime: process.uptime() }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, {
  transports: ['polling', 'websocket'],
  maxHttpBufferSize: 200_000,
  pingTimeout: 20_000,
  pingInterval: 25_000
});

const rooms = new Map();
const SEATS = [
  { x: 0.50, y: 0.43, dir: 'down' }, { x: 0.62, y: 0.49, dir: 'left' },
  { x: 0.61, y: 0.61, dir: 'up' }, { x: 0.50, y: 0.66, dir: 'up' },
  { x: 0.38, y: 0.61, dir: 'up' }, { x: 0.37, y: 0.49, dir: 'right' }
];
const spawn = i => ({ x: 0.22 + (i % 3) * 0.045, y: 0.81, dir: 'up' });
const cleanText = (v, max = 80) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const roomId = v => cleanText(v, 12).toUpperCase().replace(/[^A-Z0-9가-힣_-]/g, '') || 'MP';
const snapshot = room => ({ players: [...room.players.values()], seats: room.seats });
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { players: new Map(), seats: Array(6).fill(null), messages: [] });
  return rooms.get(id);
}
function broadcast(id) { const room = rooms.get(id); if (room) io.to(id).emit('roomState', snapshot(room)); }

io.on('connection', socket => {
  socket.on('joinRoom', (payload = {}, reply = () => {}) => {
    const id = roomId(payload.room);
    const room = getRoom(id);
    if (room.players.size >= 6) return reply({ ok: false, code: 'ROOM_FULL', message: '이 방은 6명 정원입니다.' });
    const p = {
      id: socket.id,
      name: cleanText(payload.name || '친구', 10),
      avatar: {
        base: ['a','b'].includes(payload.avatar?.base) ? payload.avatar.base : 'a',
        eyes: ['round','smile','sleepy'].includes(payload.avatar?.eyes) ? payload.avatar.eyes : 'round',
        hair: ['short','bob','long'].includes(payload.avatar?.hair) ? payload.avatar.hair : 'short',
        hairColor: /^#[0-9a-f]{6}$/i.test(payload.avatar?.hairColor || '') ? payload.avatar.hairColor : '#201a25',
        outfit: ['uplus','lg','hanwha','samsung','doosan','kia','casual'].includes(payload.avatar?.outfit) ? payload.avatar.outfit : 'uplus'
      },
      ...spawn(room.players.size), seat: null, glass: 0, drink: '빈 잔', drunk: 0, raised: false, bubble: ''
    };
    room.players.set(socket.id, p); socket.join(id); socket.data.room = id;
    reply({ ok: true, room: id, selfId: socket.id, state: snapshot(room) });
    socket.to(id).emit('systemMessage', `${p.name}님이 들어왔습니다.`); broadcast(id);
  });

  socket.on('move', data => {
    const id = socket.data.room, room = rooms.get(id), p = room?.players.get(socket.id); if (!p || p.seat !== null) return;
    const x = Number(data?.x), y = Number(data?.y); if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const nx = Math.max(.08, Math.min(.92, x)), ny = Math.max(.18, Math.min(.90, y));
    if (Math.hypot(nx - p.x, ny - p.y) > .08) return;
    p.x = nx; p.y = ny; p.dir = ['up','down','left','right'].includes(data.dir) ? data.dir : p.dir;
    socket.to(id).emit('playerMoved', { id: p.id, x: p.x, y: p.y, dir: p.dir });
  });

  socket.on('sit', (seatIndex, reply = () => {}) => {
    const id = socket.data.room, room = rooms.get(id), p = room?.players.get(socket.id); const i = Number(seatIndex);
    if (!p || !Number.isInteger(i) || i < 0 || i > 5) return reply({ ok:false });
    if (room.seats[i] && room.seats[i] !== socket.id) return reply({ ok:false, message:'이미 사용 중인 좌석입니다.' });
    if (p.seat !== null) room.seats[p.seat] = null;
    room.seats[i] = socket.id; p.seat = i; Object.assign(p, SEATS[i]); broadcast(id); reply({ ok:true });
  });
  socket.on('stand', () => { const id=socket.data.room, r=rooms.get(id), p=r?.players.get(socket.id); if(!p||p.seat===null)return; r.seats[p.seat]=null;p.seat=null; broadcast(id); });
  socket.on('chat', raw => { const id=socket.data.room,r=rooms.get(id),p=r?.players.get(socket.id);if(!p)return;const text=cleanText(raw,120);if(!text)return;p.bubble=text;r.messages.push({id:socket.id,name:p.name,text,at:Date.now()});r.messages=r.messages.slice(-50);io.to(id).emit('chat',{id:p.id,name:p.name,text,at:Date.now()});setTimeout(()=>{if(p.bubble===text){p.bubble='';io.to(id).emit('bubbleClear',p.id)}},3500); });
  socket.on('selectDrink', d => { const id=socket.data.room,r=rooms.get(id),p=r?.players.get(socket.id);if(!p)return;p.drink=cleanText(d?.label||'맥주',40);p.glass=100;broadcast(id); });
  socket.on('pourDrink', targetId => { const id=socket.data.room,r=rooms.get(id),from=r?.players.get(socket.id),to=r?.players.get(String(targetId));if(!from||!to)return;to.glass=100;io.to(id).emit('pourEffect',{from:from.id,to:to.id,drink:to.drink});broadcast(id); });
  socket.on('raiseGlass', () => { const id=socket.data.room,r=rooms.get(id),p=r?.players.get(socket.id);if(!p)return;p.raised=!p.raised;broadcast(id); });
  socket.on('drinkSip', () => { const id=socket.data.room,r=rooms.get(id),p=r?.players.get(socket.id);if(!p||p.glass<=0)return;p.glass=Math.max(0,p.glass-25);p.drunk=Math.min(4,p.drunk+.45);p.raised=false;broadcast(id); });
  socket.on('cheers', raw => { const id=socket.data.room,r=rooms.get(id),p=r?.players.get(socket.id);if(!p)return;const base=cleanText(raw,60).replace(/위하여!?/g,'').trim()||'오늘의 우리를';for(const x of r.players.values())x.raised=true;io.to(id).emit('cheers',{by:p.name,text:`${base} 위하여!`});broadcast(id); });
  socket.on('disconnect', () => { const id=socket.data.room,r=rooms.get(id);if(!r)return;const p=r.players.get(socket.id);if(p?.seat!==null)r.seats[p.seat]=null;r.players.delete(socket.id);if(r.players.size===0)rooms.delete(id);else{io.to(id).emit('systemMessage',`${p?.name||'사용자'}님이 나갔습니다.`);broadcast(id);} });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Random Today Tudari listening on ${PORT}`));
