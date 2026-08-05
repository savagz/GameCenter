import { io } from 'socket.io-client';

export const socket = io({ path: '/games/rummy/socket.io', transports: ['websocket', 'polling'] });
