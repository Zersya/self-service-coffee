import React, { useState, useEffect } from 'react';
import { Coffee, QrCode, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

const PRICE_PER_250G = 100000;
const PRICE_PER_GRAM = PRICE_PER_250G / 250;

declare global {
  interface Window {
    snap: any;
  }
}

export default function App() {
  const [grams, setGrams] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = grams ? Math.round(parseFloat(grams) * PRICE_PER_GRAM) : 0;

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (!data.clientKey) {
          console.warn("Midtrans Client Key is missing");
          return;
        }
        const script = document.createElement('script');
        script.src = data.isProduction 
          ? 'https://app.midtrans.com/snap/snap.js'
          : 'https://app.sandbox.midtrans.com/snap/snap.js';
        script.setAttribute('data-client-key', data.clientKey);
        script.async = true;
        document.body.appendChild(script);
      })
      .catch(err => console.error("Failed to load config", err));
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (orderId && (status === 'pending' || !status)) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/status/${orderId}`);
          const data = await res.json();
          if (data.status) {
            setStatus(data.status);
            if (data.status === 'settlement' || data.status === 'capture') {
              clearInterval(interval);
            } else if (data.status === 'expire' || data.status === 'cancel' || data.status === 'deny') {
              clearInterval(interval);
            }
          }
        } catch (err) {
          console.error("Failed to fetch status", err);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [orderId, status]);

  const handleGenerateQR = async () => {
    if (!grams || parseFloat(grams) <= 0) {
      setError("Please enter a valid amount of grams.");
      return;
    }

    setLoading(true);
    setError(null);
    setOrderId(null);
    setStatus(null);

    try {
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount, grams: parseFloat(grams) }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate transaction');
      }

      setOrderId(data.orderId);
      setStatus(data.status);

      if (window.snap) {
        // Use embed instead of pay for a seamless in-page experience
        window.snap.embed(data.token, {
          embedId: 'snap-container',
          onSuccess: function(result: any) {
            setStatus('settlement');
          },
          onPending: function(result: any) {
            setStatus('pending');
          },
          onError: function(result: any) {
            setStatus('cancel');
            setError('Payment failed');
          },
          onClose: function() {
            // User closed the embedded UI or it was unmounted
          }
        });
      } else {
        // Fallback if snap.js failed to load
        window.location.href = data.redirectUrl;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPayment = () => {
    setGrams('');
    setOrderId(null);
    setStatus(null);
    setError(null);
  };

  const isSuccess = status === 'settlement' || status === 'capture';
  const isFailed = status === 'expire' || status === 'cancel' || status === 'deny';

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4 font-sans text-stone-800">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl overflow-hidden border border-stone-200">
        <div className="bg-stone-900 p-6 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0,0 L100,0 L100,100 L0,100 Z" fill="url(#pattern)" />
              <defs>
                <pattern id="pattern" width="10" height="10" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1" fill="currentColor" />
                </pattern>
              </defs>
            </svg>
          </div>
          <Coffee className="w-12 h-12 mx-auto mb-3 text-amber-400 relative z-10" />
          <h1 className="text-2xl font-bold tracking-tight relative z-10">Honesty Bar</h1>
          <p className="text-stone-400 text-sm mt-1 relative z-10">Self-Service Coffee Payment</p>
        </div>

        <div className="p-6 sm:p-8">
          {!orderId && !isSuccess && (
            <div className="space-y-6">
              <div>
                <label htmlFor="grams" className="block text-sm font-medium text-stone-600 mb-2">
                  Coffee Used (grams)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id="grams"
                    min="0"
                    step="0.1"
                    value={grams}
                    onChange={(e) => setGrams(e.target.value)}
                    className="w-full text-3xl font-bold text-stone-800 bg-stone-50 border-2 border-stone-200 rounded-xl py-4 px-4 pr-16 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all"
                    placeholder="0"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 font-medium">
                    g
                  </span>
                </div>
                <p className="text-xs text-stone-400 mt-2 text-right">
                  Rate: Rp 100.000 / 250g
                </p>
              </div>

              <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 flex items-center justify-between">
                <span className="text-amber-800 font-medium">Total to Pay</span>
                <span className="text-2xl font-bold text-amber-900">
                  Rp {amount.toLocaleString('id-ID')}
                </span>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                  <XCircle className="w-5 h-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              <button
                onClick={handleGenerateQR}
                disabled={loading || amount <= 0}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-4 rounded-xl shadow-lg shadow-stone-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating QRIS...
                  </>
                ) : (
                  <>
                    <QrCode className="w-5 h-5" />
                    Pay with QRIS
                  </>
                )}
              </button>
            </div>
          )}

          {orderId && !isSuccess && !isFailed && (
            <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-300">
              <div className="text-center">
                <h2 className="text-xl font-bold text-stone-800">Complete Payment</h2>
                <p className="text-stone-500 text-sm mt-1">Rp {amount.toLocaleString('id-ID')}</p>
              </div>
              
              <div className="w-full bg-white rounded-2xl shadow-sm border-2 border-stone-100 overflow-hidden">
                {/* This is where the Midtrans Snap UI will be embedded */}
                <div id="snap-container" className="w-full min-h-[400px]"></div>
              </div>

              <button
                onClick={resetPayment}
                className="text-stone-500 hover:text-stone-800 text-sm font-medium transition-colors"
              >
                Cancel Payment
              </button>
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-300 py-4">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-2">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-stone-800">Payment Successful!</h2>
                <p className="text-stone-500 mt-2">Thank you for your honesty.</p>
                <p className="text-lg font-medium text-stone-800 mt-1">Rp {amount.toLocaleString('id-ID')}</p>
              </div>
              <button
                onClick={resetPayment}
                className="w-full bg-stone-100 hover:bg-stone-200 text-stone-800 font-medium py-4 rounded-xl transition-all flex items-center justify-center gap-2 mt-4"
              >
                <RefreshCw className="w-5 h-5" />
                New Payment
              </button>
            </div>
          )}

          {isFailed && (
            <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-300 py-4">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-2">
                <XCircle className="w-10 h-10" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-bold text-stone-800">Payment Failed</h2>
                <p className="text-stone-500 mt-2">The transaction expired or was cancelled.</p>
              </div>
              <button
                onClick={resetPayment}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-4 rounded-xl transition-all flex items-center justify-center gap-2 mt-4"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
