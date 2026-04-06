import React, { useState, useEffect, useRef } from 'react';
import { Coffee, QrCode, CheckCircle2, XCircle, Loader2, RefreshCw, History, Wallet, LayoutDashboard, X, Hourglass } from 'lucide-react';

declare global {
  interface Window {
    snap: any;
  }
}

function Dashboard({ onPayOrder }: { onPayOrder?: (grams: string, amount: number, orderId: string, snapToken: string | null) => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [regeneratingToken, setRegeneratingToken] = useState(false);
  const [orderActionError, setOrderActionError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/balance').then(res => res.json()),
      fetch('/api/history').then(res => res.json())
    ]).then(([balanceData, historyData]) => {
      if (balanceData.error || historyData.error) {
        setDbError(balanceData.error || historyData.error);
      } else {
        setBalance(balanceData.balance);
        setHistory(historyData);
      }
      setLoading(false);
    }).catch(err => {
      setDbError("Failed to connect to server");
      setLoading(false);
    });
  }, []);

  // Order modal handlers
  const handleOrderClick = (order: any) => {
    setSelectedOrder(order);
    setShowOrderModal(true);
    setOrderActionError(null);
  };

  const handlePayNow = async () => {
    if (!selectedOrder || !onPayOrder) return;
    
    setRegeneratingToken(true);
    setOrderActionError(null);
    
    try {
      // Call backend to create NEW order with fresh token
      const response = await fetch(`/api/continue-payment/${selectedOrder.orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text.substring(0, 500));
        throw new Error('Server returned invalid response. Please check server logs.');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to regenerate payment link');
      }
      
      if (!data.token) {
        throw new Error('No token received from server');
      }
      
      // Close modal and switch to Pay tab with NEW order
      setShowOrderModal(false);
      onPayOrder(data.grams, data.amount, data.orderId, data.token);
      setSelectedOrder(null);
    } catch (err: any) {
      console.error('Regenerate token error:', err);
      setOrderActionError(err.message || 'Failed to prepare payment. Please try again.');
    } finally {
      setRegeneratingToken(false);
    }
  };

  const handleCancelFromModal = async () => {
    if (!selectedOrder) return;
    
    setCancellingOrder(true);
    setOrderActionError(null);
    
    try {
      const res = await fetch(`/api/cancel/${selectedOrder.orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      
      if (data.success) {
        // Refresh history
        const historyRes = await fetch('/api/history');
        const historyData = await historyRes.json();
        setHistory(historyData);
        
        setShowOrderModal(false);
        setSelectedOrder(null);
      } else {
        setOrderActionError(data.message || 'Failed to cancel');
      }
    } catch (err) {
      setOrderActionError('Network error. Please try again.');
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleCloseOrderModal = () => {
    setShowOrderModal(false);
    setSelectedOrder(null);
    setOrderActionError(null);
  };

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-500" /></div>;

  if (dbError) return (
    <div className="p-8 text-center">
      <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-4">
        <p className="font-medium">Database Not Configured</p>
        <p className="text-sm mt-1">Please set DATABASE_URL in your secrets and run `npm run db:push`.</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 sm:p-8">
      <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100 mb-6">
        <div className="flex items-center gap-3 text-amber-800 mb-2">
          <Wallet className="w-5 h-5" />
          <h3 className="font-medium">Total Revenue</h3>
        </div>
        <p className="text-3xl font-bold text-amber-900">Rp {balance.toLocaleString('id-ID')}</p>
      </div>

      <h3 className="font-medium text-stone-800 mb-4 flex items-center gap-2">
        <History className="w-5 h-5" /> Recent Orders
      </h3>
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
        {history.length === 0 ? (
          <p className="text-stone-500 text-sm text-center py-4">No orders yet</p>
        ) : (
          history.map(order => (
            <div 
              key={order.id} 
              onClick={() => handleOrderClick(order)}
              className="bg-white border border-stone-200 rounded-xl p-4 flex justify-between items-center cursor-pointer hover:bg-stone-50 hover:border-stone-300 transition-all"
            >
              <div>
                <p className="font-medium text-stone-800">Rp {order.amount.toLocaleString('id-ID')}</p>
                <p className="text-xs text-stone-500">{order.grams}g Coffee • {new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                order.status === 'settlement' || order.status === 'capture' ? 'bg-green-100 text-green-700' :
                order.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {order.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Order Details Modal */}
      {showOrderModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            onClick={handleCloseOrderModal}
          />
          
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            
            {/* Status Icon */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' 
                ? 'bg-green-100' 
                : selectedOrder.status === 'pending'
                ? 'bg-amber-100'
                : 'bg-red-100'
            }`}>
              {selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' ? (
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              ) : selectedOrder.status === 'pending' ? (
                <Hourglass className="w-8 h-8 text-amber-600" />
              ) : (
                <XCircle className="w-8 h-8 text-red-600" />
              )}
            </div>
                
                <h3 className="text-xl font-bold text-stone-800 text-center mb-4">
                  Order Details
                </h3>
                
                {/* Details Grid */}
                <div className="space-y-3 mb-6 bg-stone-50 rounded-xl p-4">
                  <div className="flex justify-between">
                    <span className="text-stone-500">Amount</span>
                    <span className="font-semibold text-stone-800">
                      Rp {selectedOrder.amount.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Coffee</span>
                    <span className="font-semibold text-stone-800">
                      {selectedOrder.grams}g
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500">Date</span>
                    <span className="font-semibold text-stone-800 text-xs">
                      {new Date(selectedOrder.createdAt).toLocaleString('id-ID')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-stone-500">Status</span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' 
                        ? 'bg-green-100 text-green-700' 
                        : selectedOrder.status === 'pending'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {selectedOrder.status}
                    </span>
                  </div>
                </div>
                
                {/* Error Message */}
                {orderActionError && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 text-center">
                    {orderActionError}
                  </div>
                )}
                
                {/* Action Buttons - Only for pending orders */}
                {selectedOrder.status === 'pending' ? (
                  <div className="space-y-3 mb-4">
                    <button
                      onClick={handlePayNow}
                      disabled={regeneratingToken}
                      className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-3 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {regeneratingToken ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Creating New Payment...
                        </>
                      ) : (
                        <>
                          <QrCode className="w-5 h-5" />
                          Pay in Pay Tab
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleCancelFromModal}
                      disabled={cancellingOrder || regeneratingToken}
                      className="w-full bg-red-100 hover:bg-red-200 text-red-700 font-medium py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {cancellingOrder ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Cancelling...
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4" />
                          Cancel Order
                        </>
                      )}
                    </button>
                  </div>
                ) : null}
                
                {/* Close Button */}
                <button
                  onClick={handleCloseOrderModal}
                  className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium py-3 rounded-xl transition-all"
                >
                  Close
                </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'pay' | 'dashboard'>('pay');
  const [grams, setGrams] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapReady, setSnapReady] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  
  // Pricing state
  const [pricing, setPricing] = useState<{ pricePer250g: number; pricePerGram: number } | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  
  // Payment tab cancel modal states
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const amount = grams && pricing ? Math.round(parseFloat(grams) * pricing.pricePerGram) : 0;

  // Pending order from dashboard (for continuing payment)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingSnapToken, setPendingSnapToken] = useState<string | null>(null);
  const snapEmbedInProgress = useRef(false);

  // Handle paying an order from dashboard - switches to pay tab and shows snap embed
  const handlePayOrder = (orderGrams: string, orderAmount: number, orderId: string, snapToken: string) => {
    // First clear any existing snap embed
    if (window.snap && typeof window.snap.hide === 'function') {
      try {
        window.snap.hide();
      } catch (e) {
        console.log('Snap hide error (expected):', e);
      }
    }
    
    // Clear the snap container
    const container = document.getElementById('snap-container');
    if (container) {
      container.innerHTML = '';
    }
    
    setActiveTab('pay');
    setGrams(orderGrams);
    setOrderId(orderId);
    setPendingOrderId(orderId);
    setPendingSnapToken(null); // Clear first to reset
    setStatus('pending');
    setError(null);
    
    // Set the new token after a short delay to ensure cleanup
    setTimeout(() => {
      setPendingSnapToken(snapToken);
    }, 50);
  };

  // Auto-embed snap when there's a pending order from dashboard
  useEffect(() => {
    if (pendingSnapToken && snapReady && activeTab === 'pay' && window.snap && !snapEmbedInProgress.current) {
      snapEmbedInProgress.current = true; // Mark as in progress
      
      // Small delay to ensure DOM is ready and previous snap is cleared
      setTimeout(() => {
        const container = document.getElementById('snap-container');
        if (container && snapEmbedInProgress.current) {
          // Clear any previous content
          container.innerHTML = '';
          
          try {
            window.snap.embed(pendingSnapToken, {
              embedId: 'snap-container',
              onSuccess: function(result: any) {
                snapEmbedInProgress.current = false;
                setStatus('settlement');
                setPendingSnapToken(null); // Clear pending token
              },
              onPending: function(result: any) {
                setStatus('pending');
              },
              onError: function(result: any) {
                snapEmbedInProgress.current = false;
                setStatus('cancel');
                setError('Payment failed: ' + (result.status_message || 'Unknown error'));
                setPendingSnapToken(null); // Clear on error
              },
              onClose: function() {
                snapEmbedInProgress.current = false;
                // User closed the snap UI
              }
            });
          } catch (err: any) {
            snapEmbedInProgress.current = false;
            console.error('Snap embed error:', err);
            // If snap is already used, show error and clear
            if (err?.message?.includes('Invalid state transition')) {
              setError('This payment link has already been used. Please go back to dashboard and try again with a fresh order.');
              setPendingSnapToken(null);
            }
          }
        }
      }, 200); // Increased delay to 200ms for better cleanup
    }
  }, [pendingSnapToken, snapReady, activeTab]);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (!data.clientKey) {
          console.warn("Midtrans Client Key is missing");
          setSnapError("Midtrans configuration missing");
          return;
        }
        
        // Check if script already exists
        if (document.getElementById('midtrans-snap-script')) {
          if (window.snap) {
            setSnapReady(true);
          }
          return;
        }
        
        const script = document.createElement('script');
        script.id = 'midtrans-snap-script';
        script.src = data.isProduction 
          ? 'https://app.midtrans.com/snap/snap.js'
          : 'https://app.sandbox.midtrans.com/snap/snap.js';
        script.setAttribute('data-client-key', data.clientKey);
        script.async = true;
        
        script.onload = () => {
          console.log('Midtrans Snap script loaded successfully');
          setSnapReady(true);
          setSnapError(null);
        };
        
        script.onerror = () => {
          console.error('Failed to load Midtrans Snap script');
          setSnapError('Failed to load payment system');
        };
        
        document.body.appendChild(script);
      })
      .catch(err => {
        console.error("Failed to load config", err);
        setSnapError('Failed to load configuration');
      });
  }, []);

  useEffect(() => {
    fetch('/api/pricing')
      .then(res => res.json())
      .then(data => {
        if (data.pricePer250g && data.pricePerGram) {
          setPricing({
            pricePer250g: data.pricePer250g,
            pricePerGram: data.pricePerGram
          });
          setPricingError(null);
        } else {
          console.error("Invalid pricing data received:", data);
          setPricingError("Failed to load pricing configuration");
        }
      })
      .catch(err => {
        console.error("Failed to load pricing", err);
        setPricingError("Failed to load pricing");
      });
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

    if (!snapReady) {
      setError("Payment system is still loading. Please wait a moment and try again.");
      return;
    }

    // Reset snap embed tracking
    snapEmbedInProgress.current = false;
    // Clear any pending dashboard order
    setPendingSnapToken(null);
    
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

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        if (window.snap) {
          try {
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
                setError('Payment failed: ' + (result.status_message || 'Unknown error'));
              },
              onClose: function() {
                // User closed the embedded UI or it was unmounted
              }
            });
          } catch (err: any) {
            console.error('Snap embed error:', err);
            setError('Failed to initialize payment interface. Please refresh and try again.');
          }
        } else {
          setError('Payment system not available. Please refresh the page.');
        }
      }, 100);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPayment = () => {
    // Clean up snap embed if it exists
    const snapContainer = document.getElementById('snap-container');
    if (snapContainer) {
      snapContainer.innerHTML = '';
    }
    // Reset tracking refs and states
    snapEmbedInProgress.current = false;
    setPendingSnapToken(null);
    setGrams('');
    setOrderId(null);
    setStatus(null);
    setError(null);
  };

  // Cancel modal handlers
  const handleCancelClick = () => {
    setShowCancelModal(true);
    setCancelError(null);
  };

  const handleConfirmCancel = async () => {
    if (!orderId) return;
    
    setCancelling(true);
    setCancelError(null);
    
    try {
      const res = await fetch(`/api/cancel/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      
      if (data.success) {
        setShowCancelModal(false);
        setStatus('cancel');
        // Clear snap container and reset tracking
        const snapContainer = document.getElementById('snap-container');
        if (snapContainer) snapContainer.innerHTML = '';
        snapEmbedInProgress.current = false;
        setPendingSnapToken(null);
      } else {
        setCancelError(data.message || 'Failed to cancel payment');
      }
    } catch (err) {
      setCancelError('Network error. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  const handleCloseCancelModal = () => {
    setShowCancelModal(false);
    setCancelError(null);
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

        <div className="flex border-b border-stone-200">
          <button
            onClick={() => setActiveTab('pay')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'pay' ? 'text-amber-600 border-b-2 border-amber-500 bg-amber-50/50' : 'text-stone-500 hover:text-stone-700 bg-stone-50'}`}
          >
            <QrCode className="w-4 h-4" /> Pay
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'dashboard' ? 'text-amber-600 border-b-2 border-amber-500 bg-amber-50/50' : 'text-stone-500 hover:text-stone-700 bg-stone-50'}`}
          >
            <LayoutDashboard className="w-4 h-4" /> Dashboard
          </button>
        </div>

        {activeTab === 'pay' ? (
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
                  Rate: Rp {pricing ? pricing.pricePer250g.toLocaleString('id-ID') : '...'} / 250g
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

              {pricingError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                  <XCircle className="w-5 h-5 shrink-0" />
                  <p>Pricing configuration unavailable: {pricingError}</p>
                </div>
              )}

              {snapError && (
                <div className="bg-amber-50 text-amber-700 p-3 rounded-lg text-sm flex items-start gap-2">
                  <XCircle className="w-5 h-5 shrink-0" />
                  <p>Payment system unavailable: {snapError}</p>
                </div>
              )}

              <button
                onClick={handleGenerateQR}
                disabled={loading || amount <= 0 || !snapReady || !pricing}
                className="w-full bg-stone-900 hover:bg-stone-800 text-white font-medium py-4 rounded-xl shadow-lg shadow-stone-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating QRIS...
                  </>
                ) : !pricing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading Pricing...
                  </>
                ) : !snapReady ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Loading Payment System...
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
                <div id="snap-container" className="w-full min-h-[400px] flex items-center justify-center">
                  {!snapReady && (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-500 mb-2" />
                      <p className="text-stone-500 text-sm">Loading payment interface...</p>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleCancelClick}
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
        ) : (
          <Dashboard onPayOrder={handlePayOrder} />
        )}
      </div>

      {/* Payment Tab Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm transition-opacity"
            onClick={handleCloseCancelModal}
          />
          
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-amber-600" />
            </div>
            
            <h3 className="text-xl font-bold text-stone-800 text-center mb-2">
              Cancel Payment?
            </h3>
            
            <div className="text-center mb-4">
              <p className="text-lg font-semibold text-stone-800">
                Rp {amount.toLocaleString('id-ID')}
              </p>
              <p className="text-sm text-stone-500">
                Order: {orderId?.slice(0, 20)}...
              </p>
            </div>
            
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-6">
              <p className="text-xs text-amber-700 text-center">
                This action cannot be undone. The transaction will be permanently cancelled.
              </p>
            </div>
            
            {cancelError && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 text-center">
                {cancelError}
              </div>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={handleCloseCancelModal}
                disabled={cancelling}
                className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium py-3 rounded-xl transition-all disabled:opacity-50"
              >
                No, Keep It
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 bg-amber-100 hover:bg-amber-200 text-amber-700 font-medium py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
