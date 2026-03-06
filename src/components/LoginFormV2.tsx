'use client';

import { useState, FormEvent } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';

export default function LoginFormV2() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Invalid credentials');
        setPassword('');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', damping: 30, stiffness: 200 }}
      className="w-full max-w-[340px]"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', damping: 25 }}
        className="flex flex-col items-center mb-10"
      >
        <div className="w-[60px] h-[60px] rounded-[16px] bg-[#1a1a1a] flex items-center justify-center mb-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#1a1a1a]">
          Project Cortex
        </h1>
        <p className="text-[14px] text-[#999] mt-1">Construction Intelligence</p>
      </motion.div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoFocus
          autoComplete="email"
          className="w-full h-[44px] px-[14px] rounded-[10px] border border-[#e5e5e5] bg-white text-[#1a1a1a] placeholder-[#b4b4b4] text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]/40 transition-all"
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full h-[44px] px-[14px] rounded-[10px] border border-[#e5e5e5] bg-white text-[#1a1a1a] placeholder-[#b4b4b4] text-[15px] focus:outline-none focus:ring-2 focus:ring-[#007aff]/20 focus:border-[#007aff]/40 transition-all"
        />

        {error && (
          <motion.p
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: [0, -3, 3, -3, 0] }}
            transition={{ duration: 0.3 }}
            className="text-[13px] text-[#ff3b30] pl-0.5"
          >
            {error}
          </motion.p>
        )}

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="submit"
          disabled={loading || !email || !password}
          className="w-full h-[44px] rounded-[10px] bg-[#007aff] hover:bg-[#0066d6] disabled:bg-[#f0f0f0] disabled:text-[#b4b4b4] text-white font-medium text-[15px] transition-colors"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </motion.button>
      </form>

      <p className="text-center text-[13px] text-[#999] mt-6">
        New to Cortex?{' '}
        <a href="/signup" className="text-[#007aff] hover:underline font-medium">
          Create an account
        </a>
      </p>
    </motion.div>
  );
}
