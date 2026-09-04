import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { MessageCircle, Send, Check, CheckCheck, Clock, User, Phone } from 'lucide-react';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  lastMessageAt: string;
  unreadCount: number;
  messages: Message[];
}

interface Message {
  id: string;
  contactId: string;
  messageId: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: string;
  status: string;
  createdAt: string;
}

export default function WhatsappChat() {
  const { apiBaseUrl, accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Contacts
  const { data: contacts = [], refetch: refetchContacts } = useQuery<Contact[]>({
    queryKey: ['whatsappContacts'],
    queryFn: async () => {
      const res = await axios.get(`${apiBaseUrl}/chat/contacts`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return res.data;
    }
  });

  // Fetch Messages for selected contact
  const { data: messages = [], refetch: refetchMessages } = useQuery<Message[]>({
    queryKey: ['whatsappMessages', selectedPhone],
    queryFn: async () => {
      if (!selectedPhone) return [];
      const res = await axios.get(`${apiBaseUrl}/chat/messages/${selectedPhone}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return res.data;
    },
    enabled: !!selectedPhone
  });

  // Mark Read Mutation
  const markReadMutation = useMutation({
    mutationFn: async (phone: string) => {
      await axios.post(`${apiBaseUrl}/chat/mark-read/${phone}`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsappContacts'] });
    }
  });

  // Send Message Mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { phone: string; text: string }) => {
      const res = await axios.post(`${apiBaseUrl}/chat/send`, payload, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      return res.data;
    },
    onSuccess: () => {
      setInputText('');
      queryClient.invalidateQueries({ queryKey: ['whatsappMessages', selectedPhone] });
      queryClient.invalidateQueries({ queryKey: ['whatsappContacts'] });
    }
  });

  useEffect(() => {
    if (selectedPhone) {
      const contact = contacts.find(c => c.phone === selectedPhone);
      if (contact && contact.unreadCount > 0) {
        markReadMutation.mutate(selectedPhone);
      }
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [selectedPhone, messages, contacts]);

  // Socket setup
  useEffect(() => {
    if (!accessToken) return;
    const socket: Socket = io(apiBaseUrl, { transports: ['websocket'], upgrade: false });
    
    socket.on('connect', () => console.log('Chat socket connected'));
    
    socket.on('WHATSAPP_MESSAGE_RECEIVED', (data: { contact: Contact, message: Message }) => {
      queryClient.invalidateQueries({ queryKey: ['whatsappContacts'] });
      if (selectedPhone === data.contact.phone) {
        queryClient.invalidateQueries({ queryKey: ['whatsappMessages', selectedPhone] });
        markReadMutation.mutate(data.contact.phone);
      }
    });

    socket.on('WHATSAPP_MESSAGE_STATUS', (msg: Message) => {
      if (selectedPhone) {
        queryClient.invalidateQueries({ queryKey: ['whatsappMessages', selectedPhone] });
      }
    });

    return () => { socket.disconnect(); };
  }, [accessToken, selectedPhone]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedPhone) return;
    sendMessageMutation.mutate({ phone: selectedPhone, text: inputText });
  };

  const getStatusIcon = (status: string) => {
    if (status === 'SENT') return <Check className="w-3 h-3 text-slate-400" />;
    if (status === 'DELIVERED') return <CheckCheck className="w-3 h-3 text-slate-400" />;
    if (status === 'READ') return <CheckCheck className="w-3 h-3 text-blue-500" />;
    return <Clock className="w-3 h-3 text-slate-400" />;
  };

  const activeContact = contacts.find(c => c.phone === selectedPhone);

  return (
    <div className="flex h-[calc(100vh-64px)] -m-6 bg-slate-50 overflow-hidden">
      {/* Sidebar: Contacts */}
      <div className="w-1/3 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-brand-600" /> WhatsApp Inbox
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map(contact => (
            <div 
              key={contact.id} 
              onClick={() => setSelectedPhone(contact.phone)}
              className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${selectedPhone === contact.phone ? 'bg-brand-50 border-brand-100' : ''}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold text-xs text-slate-800">{contact.name || contact.phone}</span>
                <span className="text-[10px] text-slate-400">
                  {new Date(contact.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[11px] text-slate-500 truncate pr-2">
                  {contact.messages?.[0]?.direction === 'OUTBOUND' ? 'You: ' : ''}
                  {contact.messages?.[0]?.content || 'Image/Document'}
                </p>
                {contact.unreadCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-brand-500 text-white flex items-center justify-center text-[9px] font-bold">
                    {contact.unreadCount}
                  </span>
                )}
              </div>
            </div>
          ))}
          {contacts.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              No conversations yet. When a customer replies, it will appear here.
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      {selectedPhone ? (
        <div className="w-2/3 flex flex-col bg-[#efeae2]">
          {/* Header */}
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800">{activeContact?.name || activeContact?.phone}</h3>
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {activeContact?.phone}
              </p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-center my-4">
              <span className="bg-yellow-100 text-yellow-800 text-[10px] px-3 py-1 rounded-full font-medium border border-yellow-200 shadow-sm">
                WhatsApp policies allow free-form replies only within 24 hours of the last customer message.
              </span>
            </div>
            {messages.map((msg, idx) => {
              const isOut = msg.direction === 'OUTBOUND';
              return (
                <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-xl px-4 py-2 text-xs shadow-sm ${isOut ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                    <p className="text-slate-800 whitespace-pre-wrap">{msg.content}</p>
                    <div className="flex justify-end items-center gap-1 mt-1 text-[9px] text-slate-400">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {isOut && getStatusIcon(msg.status)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <div className="p-3 bg-slate-50 border-t border-slate-200">
            <form onSubmit={handleSend} className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-white border border-slate-300 rounded-full px-4 py-2.5 text-xs outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sendMessageMutation.isPending}
                className="w-10 h-10 rounded-full bg-brand-600 hover:bg-brand-700 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="w-2/3 flex flex-col items-center justify-center text-slate-400 bg-slate-50">
          <MessageCircle className="w-16 h-16 mb-4 text-slate-200" />
          <h2 className="text-lg font-bold text-slate-600">WhatsApp Web</h2>
          <p className="text-xs mt-2">Select a chat to start messaging</p>
        </div>
      )}
    </div>
  );
}
