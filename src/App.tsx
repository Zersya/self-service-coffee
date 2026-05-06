import React, { useState, useEffect, useRef } from 'react';
import { Coffee, QrCode, CheckCircle2, XCircle, Loader2, RefreshCw, History, Wallet, LayoutDashboard, Hourglass, CreditCard, Check, ArrowLeftRight, Plus } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';

declare global {
  interface Window {
    snap: any;
  }
}

function Dashboard({ onPayOrder, turnstileSiteKey, beans }: { onPayOrder?: (grams: string, amount: number, orderId: string, snapToken: string | null) => void, turnstileSiteKey?: string | null, beans?: any[] }) {
  const [history, setHistory] = useState<any[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [balanceDetails, setBalanceDetails] = useState<{
    balance: number;
    totalIncome: number;
    totalMdrFees: number;
    netIncome: number;
    totalDisbursed: number;
    totalWithdrawalFees: number;
    totalFees: number;
    perBeanIncome: Array<{
      beanName: string;
      beanSlug: string;
      totalIncome: number;
      orderCount: number;
    }>;
  } | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  
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
        setBalanceDetails(balanceData);
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
    if (!turnstileToken && turnstileSiteKey) {
      setOrderActionError("Menunggu verifikasi keamanan. Silakan coba lagi.");
      return;
    }
    
    setRegeneratingToken(true);
    setOrderActionError(null);
    
    try {
      const response = await fetch(`/api/continue-payment/${selectedOrder.orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken })
      });
      
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

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-[#e68a2e]" /></div>;

  if (dbError) return (
    <div className="p-8 text-center">
      <div className="bg-[#fce8e6] text-[#d93025] p-4 rounded-2xl mb-4 font-bold border-2 border-[#d93025]/20">
        <p className="text-lg">Database Not Configured</p>
        <p className="text-sm mt-1">Please set DATABASE_URL in your secrets and run `npm run db:push`.</p>
      </div>
    </div>
  );

  return (
    <div className="p-6 sm:p-8 pt-2">
      <div className="bg-[#fff8eb] rounded-[1.5rem] p-6 border-[3px] border-[#e6d5b8] shadow-sm mb-6 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-[#e68a2e]"></div>
        <div className="flex items-center gap-3 text-[#e68a2e] mb-2 font-bold mt-2">
          <Wallet className="w-6 h-6" />
          <h3 className="uppercase tracking-widest text-sm">Saldo Tersedia</h3>
        </div>
        <p className="text-4xl font-extrabold text-[#3b2313] tracking-tight">Rp {balance.toLocaleString('id-ID')}</p>
        
        {balanceDetails && (
          <div className="mt-4 w-full space-y-2">
            {/* Income Breakdown */}
            <div className="bg-white/50 rounded-xl p-3 text-xs">
              <div className="flex justify-between font-bold text-[#825e43] mb-1">
                <span>Total Pemasukan:</span>
                <span>Rp {balanceDetails.totalIncome.toLocaleString('id-ID')}</span>
              </div>
              <div className="flex justify-between font-bold text-[#d93025] text-[10px]">
                <span>Biaya MDR (0.7%):</span>
                <span>- Rp {balanceDetails.totalMdrFees.toLocaleString('id-ID')}</span>
              </div>
              <div className="flex justify-between font-bold text-[#3b2313] border-t border-[#e6d5b8] pt-1 mt-1">
                <span>Pemasukan Bersih:</span>
                <span>Rp {balanceDetails.netIncome.toLocaleString('id-ID')}</span>
              </div>
            </div>
            
            {/* Per-Bean Income Breakdown */}
            {balanceDetails.perBeanIncome && balanceDetails.perBeanIncome.length > 0 && (
              <div className="bg-white/50 rounded-xl p-3 text-xs">
                <div className="font-bold text-[#825e43] mb-2 uppercase tracking-wide">Pemasukan per Biji Kopi:</div>
                <div className="space-y-1.5">
                  {balanceDetails.perBeanIncome.map((bean) => (
                    <div key={bean.beanSlug} className="flex justify-between items-center py-1 border-b border-[#e6d5b8]/50 last:border-0">
                      <div className="flex flex-col">
                        <span className="font-bold text-[#3b2313] text-[11px]">{bean.beanName}</span>
                        <span className="text-[9px] text-[#825e43]">{bean.orderCount} pesanan</span>
                      </div>
                      <span className="font-extrabold text-[#e68a2e] text-[11px]">
                        Rp {bean.totalIncome.toLocaleString('id-ID')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Disbursement Breakdown */}
            {(balanceDetails.totalDisbursed > 0 || balanceDetails.totalWithdrawalFees > 0) && (
              <div className="bg-white/50 rounded-xl p-3 text-xs">
                <div className="flex justify-between font-bold text-[#825e43] mb-1">
                  <span>Sudah Dicairkan:</span>
                  <span>Rp {balanceDetails.totalDisbursed.toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between font-bold text-[#d93025] text-[10px]">
                  <span>Biaya Withdrawal (Rp 5.000×):</span>
                  <span>- Rp {balanceDetails.totalWithdrawalFees.toLocaleString('id-ID')}</span>
                </div>
              </div>
            )}
            
            {/* Total Fees */}
            {balanceDetails.totalFees > 0 && (
              <div className="text-[10px] font-bold text-[#825e43] bg-[#e6d5b8]/30 px-3 py-1.5 rounded-full">
                Total Biaya: Rp {balanceDetails.totalFees.toLocaleString('id-ID')}
              </div>
            )}
          </div>
        )}
      </div>

      <h3 className="font-bold text-[#825e43] mb-4 flex items-center gap-2 uppercase tracking-wider text-sm">
        <History className="w-5 h-5 text-[#e68a2e]" /> Riwayat Pesanan
      </h3>
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {history.length === 0 ? (
          <p className="text-[#825e43] text-sm text-center py-8 font-bold bg-[#e6d5b8]/20 rounded-2xl border-2 border-dashed border-[#e6d5b8]">Belum ada pesanan</p>
        ) : (
          history.map(order => (
            <div 
              key={order.id} 
              onClick={() => handleOrderClick(order)}
              className="bg-white border-2 border-[#e6d5b8] rounded-xl p-4 flex justify-between items-center cursor-pointer hover:border-[#e68a2e] hover:shadow-md transition-all group"
            >
              <div>
                <p className="font-extrabold text-[#3b2313] text-lg group-hover:text-[#e68a2e] transition-colors">Rp {order.amount.toLocaleString('id-ID')}</p>
                <p className="text-xs font-bold text-[#825e43] mt-1">{order.grams}g {beans?.find(b => b.slug === order.beanSlug)?.name || (order.beanSlug ? order.beanSlug : 'Kopi')} • {new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-[10px] px-3 py-1.5 rounded-full font-extrabold uppercase tracking-wider ${
                order.status === 'settlement' || order.status === 'capture' ? 'bg-[#e6f4ea] text-[#1e8e3e]' :
                order.status === 'pending' ? 'bg-[#fef7e0] text-[#e68a2e]' :
                'bg-[#fce8e6] text-[#d93025]'
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
            className="absolute inset-0 bg-[#4a2e1b]/80 backdrop-blur-sm transition-opacity"
            onClick={handleCloseOrderModal}
          />
          
          <div className="relative bg-[#fff8eb] rounded-[2rem] shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto border-[4px] border-[#e6d5b8]">
            
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 border-4 ${
              selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' 
                ? 'bg-[#e6f4ea] border-[#1e8e3e]/20 text-[#1e8e3e]' 
                : selectedOrder.status === 'pending'
                ? 'bg-[#fef7e0] border-[#e68a2e]/20 text-[#e68a2e]'
                : 'bg-[#fce8e6] border-[#d93025]/20 text-[#d93025]'
            }`}>
              {selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' ? (
                <CheckCircle2 className="w-10 h-10" />
              ) : selectedOrder.status === 'pending' ? (
                <Hourglass className="w-10 h-10" />
              ) : (
                <XCircle className="w-10 h-10" />
              )}
            </div>
                
            <h3 className="text-2xl font-extrabold text-[#3b2313] text-center mb-6 uppercase tracking-wide">
              Detail Pesanan
            </h3>
            
            <div className="space-y-3 mb-6 bg-white rounded-2xl p-5 border-2 border-[#e6d5b8]">
              <div className="flex justify-between items-center">
                <span className="text-[#825e43] font-bold text-sm uppercase">Total</span>
                <span className="font-extrabold text-[#3b2313] text-xl">
                  Rp {selectedOrder.amount.toLocaleString('id-ID')}
                </span>
              </div>
              <div className="w-full h-px bg-[#e6d5b8] my-2"></div>
              <div className="flex justify-between">
                <span className="text-[#825e43] font-bold">Kopi</span>
                <span className="font-bold text-[#3b2313]">
                  {selectedOrder.grams}g {beans?.find(b => b.slug === selectedOrder.beanSlug)?.name || ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#825e43] font-bold">Tanggal</span>
                <span className="font-bold text-[#3b2313] text-xs mt-1">
                  {new Date(selectedOrder.createdAt).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-[#e6d5b8]/50">
                <span className="text-[#825e43] font-bold">Status</span>
                <span className={`text-[10px] px-3 py-1.5 rounded-full font-extrabold uppercase tracking-wider ${
                  selectedOrder.status === 'settlement' || selectedOrder.status === 'capture' 
                    ? 'bg-[#e6f4ea] text-[#1e8e3e]' 
                    : selectedOrder.status === 'pending'
                    ? 'bg-[#fef7e0] text-[#e68a2e]'
                    : 'bg-[#fce8e6] text-[#d93025]'
                }`}>
                  {selectedOrder.status}
                </span>
              </div>
            </div>
            
            {orderActionError && (
              <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl font-bold text-sm mb-4 text-center border-2 border-[#d93025]/20">
                {orderActionError}
              </div>
            )}
            
            {selectedOrder.status === 'pending' ? (
              <div className="space-y-3 mb-4">
                {turnstileSiteKey && (
                  <div className="flex justify-center mb-4">
                    <Turnstile siteKey={turnstileSiteKey} onSuccess={setTurnstileToken} />
                  </div>
                )}
                <button
                  onClick={handlePayNow}
                  disabled={regeneratingToken || (!!turnstileSiteKey && !turnstileToken)}
                  className="w-full bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold py-4 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  {regeneratingToken ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <QrCode className="w-5 h-5" />
                      Bayar Sekarang
                    </>
                  )}
                </button>
                <button
                  onClick={handleCancelFromModal}
                  disabled={cancellingOrder || regeneratingToken}
                  className="w-full bg-white border-2 border-[#d93025] hover:bg-[#fce8e6] text-[#d93025] font-bold py-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  {cancellingOrder ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Membatalkan...
                    </>
                  ) : (
                    <>
                      <XCircle className="w-5 h-5" />
                      Batal Pesanan
                    </>
                  )}
                </button>
              </div>
            ) : null}
            
            <button
              onClick={handleCloseOrderModal}
              className="w-full bg-[#e6d5b8]/30 hover:bg-[#e6d5b8] text-[#825e43] font-bold py-4 rounded-xl transition-all uppercase tracking-wide"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// DisbursementManager component for handling withdrawal requests
function DisbursementManager({ onClose, turnstileSiteKey }: { onClose: () => void, turnstileSiteKey?: string | null }) {
  const [disbursements, setDisbursements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  
  // Form states
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [requestedBy, setRequestedBy] = useState('');

  // Calculate withdrawal fee and net amount
  const withdrawalFee = 5000;
  const netAmount = amount ? Math.max(0, parseInt(amount) - withdrawalFee) : 0;

  useEffect(() => {
    fetchDisbursements();
  }, []);

  const fetchDisbursements = async () => {
    try {
      const res = await fetch('/api/disbursements');
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setDisbursements(data);
      }
    } catch (err) {
      setError('Failed to fetch disbursements');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseInt(amount) <= 0) {
      setError('Jumlah harus lebih dari 0');
      return;
    }
    if (!description.trim()) {
      setError('Deskripsi diperlukan');
      return;
    }
    if (!turnstileToken && turnstileSiteKey) {
      setError('Menunggu verifikasi keamanan. Silakan coba lagi.');
      return;
    }

    setCreateLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/disbursements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseInt(amount),
          description: description.trim(),
          requestedBy: requestedBy.trim() || 'anonymous',
          turnstileToken,
        })
      });

      const data = await res.json();
      if (data.success) {
        setDisbursements([data.disbursement, ...disbursements]);
        setShowCreateForm(false);
        setAmount('');
        setDescription('');
        setRequestedBy('');
        setTurnstileToken(null);
        setSuccessMessage('Permintaan pencairan berhasil dibuat');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(data.error || 'Gagal membuat permintaan');
      }
    } catch (err) {
      setError('Error jaringan. Coba lagi.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCancel = async (requestId: string) => {
    setActionLoading(requestId);
    setError(null);

    try {
      const res = await fetch(`/api/disbursements/${requestId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();
      if (data.success) {
        setDisbursements(disbursements.map(d => 
          d.requestId === requestId ? data.disbursement : d
        ));
        setSuccessMessage('Permintaan dibatalkan');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(data.error || 'Gagal membatalkan');
      }
    } catch (err) {
      setError('Error jaringan. Coba lagi.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return (
    <div className="p-8 text-center">
      <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#e68a2e]" />
    </div>
  );

  return (
    <div className="p-6 sm:p-8 pt-2">
      {/* Fee Information */}
      <div className="bg-[#e6f4ea]/30 border border-[#1e8e3e]/20 rounded-xl p-3 mb-4">
        <p className="text-[10px] font-bold text-[#1e8e3e] uppercase tracking-wide mb-1">
          Informasi Biaya
        </p>
        <ul className="text-[10px] text-[#825e43] font-bold space-y-1">
          <li>• MDR (0.7%): Dipotong otomatis dari setiap pembayaran QRIS</li>
          <li>• Withdrawal (Rp 5.000): Biaya transfer bank per pencairan</li>
        </ul>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-[#825e43] flex items-center gap-2 uppercase tracking-wider text-sm">
          <ArrowLeftRight className="w-5 h-5 text-[#e68a2e]" /> 
          Permintaan Pencairan
        </h3>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-[#e68a2e] hover:bg-[#c97a29] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
        >
          <Plus className="w-4 h-4" />
          {showCreateForm ? 'Batal' : 'Buat Permintaan'}
        </button>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="bg-[#e6f4ea] text-[#1e8e3e] p-3 rounded-xl mb-4 font-bold text-sm text-center border-2 border-[#1e8e3e]/20">
          {successMessage}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl mb-4 font-bold text-sm text-center border-2 border-[#d93025]/20">
          {error}
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl p-5 border-2 border-[#e6d5b8] mb-6 shadow-sm">
          <h4 className="font-extrabold text-[#3b2313] mb-4 uppercase tracking-wide">Buat Permintaan Baru</h4>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#825e43] uppercase mb-2">Jumlah (Rp)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
                className="w-full text-2xl font-extrabold text-[#3b2313] bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all text-center"
              />
              {amount && parseInt(amount) > 0 && (
                <div className="mt-2 bg-[#fef7e0] rounded-lg p-2 text-xs">
                  <div className="flex justify-between font-bold text-[#825e43]">
                    <span>Jumlah Pengajuan:</span>
                    <span>Rp {parseInt(amount).toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#d93025] text-[10px]">
                    <span>Biaya Withdrawal:</span>
                    <span>- Rp {withdrawalFee.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#3b2313] border-t border-[#e6d5b8] pt-1 mt-1">
                    <span>Yang Diterima:</span>
                    <span className="text-[#e68a2e]">Rp {netAmount.toLocaleString('id-ID')}</span>
                  </div>
                </div>
              )}
            </div>
            
            <div>
              <label className="block text-xs font-bold text-[#825e43] uppercase mb-2">Deskripsi</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Alasan pencairan dana..."
                rows={3}
                className="w-full font-bold text-[#3b2313] bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all resize-none"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-[#825e43] uppercase mb-2">Nama Pengaju (opsional)</label>
              <input
                type="text"
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Nama Anda"
                className="w-full font-bold text-[#3b2313] bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
              />
            </div>

            {/* Turnstile for bot protection */}
            {turnstileSiteKey && (
              <div className="flex justify-center pt-2">
                <Turnstile siteKey={turnstileSiteKey} onSuccess={setTurnstileToken} />
              </div>
            )}
          </div>
          
          <button
            type="submit"
            disabled={createLoading || (!!turnstileSiteKey && !turnstileToken)}
            className="w-full mt-4 bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {createLoading ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Memproses...</>
            ) : (
              <><Plus className="w-5 h-5" /> Ajukan Permintaan</>
            )}
          </button>
        </form>
      )}

      {/* Disbursements List */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {disbursements.length === 0 ? (
          <p className="text-[#825e43] text-sm text-center py-8 font-bold bg-[#e6d5b8]/20 rounded-2xl border-2 border-dashed border-[#e6d5b8]">
            Belum ada permintaan pencairan
          </p>
        ) : (
          disbursements.map((disb) => (
            <div 
              key={disb.requestId}
              className="bg-white border-2 border-[#e6d5b8] rounded-xl p-4 hover:border-[#e68a2e] transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-extrabold text-[#3b2313] text-lg">
                    Rp {disb.amount.toLocaleString('id-ID')}
                  </p>
                  <p className="text-xs font-bold text-[#825e43] mt-1">
                    {disb.requestedBy} • {new Date(disb.requestedAt).toLocaleDateString('id-ID')}
                  </p>
                </div>
                <span className={`text-[10px] px-3 py-1.5 rounded-full font-extrabold uppercase tracking-wider ${
                  disb.status === 'approved' ? 'bg-[#e6f4ea] text-[#1e8e3e]' :
                  disb.status === 'rejected' ? 'bg-[#fce8e6] text-[#d93025]' :
                  disb.status === 'cancelled' ? 'bg-[#e6d5b8] text-[#825e43]' :
                  'bg-[#fef7e0] text-[#e68a2e]'
                }`}>
                  {disb.status}
                </span>
              </div>
              
              <p className="text-sm font-bold text-[#3b2313] mb-2 bg-[#f7ede1] p-2 rounded-lg">
                {disb.description}
              </p>
              
              {/* Fee breakdown */}
              <div className="bg-[#fef7e0] rounded-lg p-2 mb-3 text-xs">
                <div className="flex justify-between font-bold text-[#825e43]">
                  <span>Biaya Withdrawal:</span>
                  <span>Rp {(disb.withdrawalFee || 5000).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between font-bold text-[#3b2313] border-t border-[#e6d5b8] pt-1 mt-1">
                  <span>Diterima Bersih:</span>
                  <span className="text-[#e68a2e]">Rp {(disb.netAmount || disb.amount - 5000).toLocaleString('id-ID')}</span>
                </div>
              </div>
              
              {disb.status === 'pending' && (
                <button
                  onClick={() => handleCancel(disb.requestId)}
                  disabled={actionLoading === disb.requestId}
                  className="w-full bg-[#fce8e6] hover:bg-[#d93025] text-[#d93025] hover:text-white font-bold py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === disb.requestId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><XCircle className="w-4 h-4" /> Batalkan Permintaan</>
                  )}
                </button>
              )}
              
              {disb.status !== 'pending' && disb.processedAt && (
                <p className="text-[10px] text-[#825e43] font-bold mt-2 uppercase tracking-wide">
                  Diproses: {new Date(disb.processedAt).toLocaleDateString('id-ID')} oleh {disb.processedBy}
                </p>
              )}
            </div>
          ))
        )}
      </div>
      
      <button
        onClick={onClose}
        className="w-full mt-6 bg-[#e6d5b8]/30 hover:bg-[#e6d5b8] text-[#825e43] font-bold py-4 rounded-xl transition-all uppercase tracking-wide"
      >
        Tutup
      </button>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'pay' | 'dashboard' | 'disbursement'>('pay');
  const [grams, setGrams] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapReady, setSnapReady] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  
  const [pricing, setPricing] = useState<{ pricePer250g: number; pricePerGram: number } | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [beans, setBeans] = useState<any[]>([]);
  const [selectedBeanSlug, setSelectedBeanSlug] = useState<string | null>(null);
  
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const selectedBean = beans.find(b => b.slug === selectedBeanSlug);
  const activePricePer250g = selectedBean ? selectedBean.pricePer250g : (pricing?.pricePer250g || 100000);
  const amount = grams && pricing ? Math.round(parseFloat(grams) * (activePricePer250g / 250)) : 0;

  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingSnapToken, setPendingSnapToken] = useState<string | null>(null);
  const snapEmbedInProgress = useRef(false);

  const handlePayOrder = (orderGrams: string, orderAmount: number, orderId: string, snapToken: string) => {
    if (window.snap && typeof window.snap.hide === 'function') {
      try { window.snap.hide(); } catch (e) { console.log('Snap hide error (expected):', e); }
    }
    
    const container = document.getElementById('snap-container');
    if (container) container.innerHTML = '';
    
    setActiveTab('pay');
    setGrams(orderGrams);
    setOrderId(orderId);
    setPendingOrderId(orderId);
    setPendingSnapToken(null);
    setStatus('pending');
    setError(null);
    
    setTimeout(() => {
      setPendingSnapToken(snapToken);
    }, 50);
  };

  useEffect(() => {
    if (pendingSnapToken && snapReady && activeTab === 'pay' && window.snap && !snapEmbedInProgress.current) {
      snapEmbedInProgress.current = true; 
      setTimeout(() => {
        const container = document.getElementById('snap-container');
        if (container && snapEmbedInProgress.current) {
          container.innerHTML = '';
          try {
            window.snap.embed(pendingSnapToken, {
              embedId: 'snap-container',
              uiMode: 'qr',
              onSuccess: function(result: any) {
                snapEmbedInProgress.current = false;
                setStatus('settlement');
                setPendingSnapToken(null);
              },
              onPending: function(result: any) {
                setStatus('pending');
              },
              onError: function(result: any) {
                snapEmbedInProgress.current = false;
                setStatus('cancel');
                setError('Payment failed: ' + (result.status_message || 'Unknown error'));
                setPendingSnapToken(null);
              },
              onClose: function() {
                snapEmbedInProgress.current = false;
              }
            });
          } catch (err: any) {
            snapEmbedInProgress.current = false;
            console.error('Snap embed error:', err);
            if (err?.message?.includes('Invalid state transition')) {
              setError('This payment link has already been used. Please go back to dashboard and try again with a fresh order.');
              setPendingSnapToken(null);
            }
          }
        }
      }, 200); 
    }
  }, [pendingSnapToken, snapReady, activeTab]);

  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.turnstileSiteKey) {
          setTurnstileSiteKey(data.turnstileSiteKey);
        }
        if (!data.clientKey) {
          setSnapError("Midtrans configuration missing");
          return;
        }
        if (document.getElementById('midtrans-snap-script')) {
          if (window.snap) setSnapReady(true);
          return;
        }
        const script = document.createElement('script');
        script.id = 'midtrans-snap-script';
        script.src = data.isProduction 
          ? 'https://app.midtrans.com/snap/snap.js'
          : 'https://app.sandbox.midtrans.com/snap/snap.js';
        script.setAttribute('data-client-key', data.clientKey);
        script.async = true;
        script.onload = () => { setSnapReady(true); setSnapError(null); };
        script.onerror = () => { setSnapError('Failed to load payment system'); };
        document.body.appendChild(script);
      })
      .catch(err => setSnapError('Failed to load configuration'));
  }, []);

  useEffect(() => {
    fetch('/api/pricing')
      .then(res => res.json())
      .then(data => {
        if (data.pricePer250g && data.pricePerGram) {
          setPricing({ pricePer250g: data.pricePer250g, pricePerGram: data.pricePerGram });
          setPricingError(null);
        } else {
          setPricingError("Failed to load pricing configuration");
        }
        if (data.beans && data.beans.length > 0) {
          setBeans(data.beans);
          if (!selectedBeanSlug) {
            const firstActive = data.beans.find((b: any) => b.isActive) || data.beans[0];
            setSelectedBeanSlug(firstActive.slug);
          }
        } else if (data.beans && data.beans.length === 0 && !selectedBeanSlug) {
          setSelectedBeanSlug(null);
        }
      })
      .catch(err => setPricingError("Failed to load pricing"));
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
            if (['settlement', 'capture', 'expire', 'cancel', 'deny'].includes(data.status)) {
              clearInterval(interval);
            }
          }
        } catch (err) {}
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [orderId, status]);

  const handleGenerateQR = async () => {
    if (!grams || parseFloat(grams) <= 0) {
      setError("Masukkan jumlah gramasi yang valid.");
      return;
    }
    if (!snapReady) {
      setError("Sistem pembayaran belum siap. Mohon tunggu sebentar.");
      return;
    }
    if (!turnstileToken && turnstileSiteKey) {
      setError("Menunggu verifikasi keamanan. Silakan coba lagi.");
      return;
    }

    snapEmbedInProgress.current = false;
    setPendingSnapToken(null);
    setLoading(true);
    setError(null);
    setOrderId(null);
    setStatus(null);

    try {
      const res = await fetch('/api/charge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, grams: parseFloat(grams), beanSlug: selectedBeanSlug, turnstileToken }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat transaksi');

      setOrderId(data.orderId);
      setStatus(data.status);

      setTimeout(() => {
        if (window.snap) {
          try {
            window.snap.embed(data.token, {
              embedId: 'snap-container',
              uiMode: 'qr',
              onSuccess: () => setStatus('settlement'),
              onPending: () => setStatus('pending'),
              onError: (result: any) => {
                setStatus('cancel');
                setError('Payment failed: ' + (result.status_message || 'Unknown error'));
              },
              onClose: () => {}
            });
          } catch (err: any) {
            setError('Gagal memuat interface pembayaran. Coba refresh halaman.');
          }
        } else {
          setError('Sistem pembayaran tidak tersedia. Coba refresh halaman.');
        }
      }, 100);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPayment = () => {
    const snapContainer = document.getElementById('snap-container');
    if (snapContainer) snapContainer.innerHTML = '';
    snapEmbedInProgress.current = false;
    setPendingSnapToken(null);
    setGrams('');
    setOrderId(null);
    setStatus(null);
    setError(null);
  };

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
        const snapContainer = document.getElementById('snap-container');
        if (snapContainer) snapContainer.innerHTML = '';
        snapEmbedInProgress.current = false;
        setPendingSnapToken(null);
      } else {
        setCancelError(data.message || 'Gagal membatalkan transaksi');
      }
    } catch (err) {
      setCancelError('Error jaringan. Coba lagi.');
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
    <div className="min-h-screen bg-[#4a2e1b] flex flex-col items-center justify-center p-4 sm:p-6 font-sans text-[#3b2313] relative overflow-hidden">
      
      {/* Decorative Elements matching poster style */}
      <div className="absolute top-10 left-10 opacity-20 text-[#e68a2e] animate-float pointer-events-none">
        <Coffee className="w-24 h-24" />
      </div>
      <div className="absolute bottom-20 right-10 opacity-20 text-[#e68a2e] animate-float-delayed pointer-events-none">
        <Coffee className="w-32 h-32" />
      </div>

      <div className="max-w-md w-full relative z-10 space-y-4">
        
        {/* Header matching poster style */}
        <div className="text-center space-y-2 mb-2 mt-4">
          <h2 className="text-xl font-extrabold text-[#fdf4e3] uppercase tracking-wider">Patungan</h2>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#fdf4e3] uppercase tracking-widest leading-tight">
            Minum Kopi
          </h1>
          <div className="mt-6 mb-4 inline-block bg-[#e68a2e] text-white px-6 py-2 rounded-full font-bold text-sm uppercase tracking-wider shadow-lg border border-[#e68a2e]/50 shadow-[#e68a2e]/40">
            Biar bisa nambah alat kopi!
          </div>
        </div>

        {/* Main App Container */}
        <div className="bg-[#fff8eb] rounded-[2rem] shadow-2xl overflow-hidden border-b-8 border-[#e6d5b8]">
          
          {/* Tabs - horizontally scrollable on mobile */}
          <div className="flex overflow-x-auto flex-nowrap bg-[#f7ede1] p-2 m-4 rounded-2xl gap-2 shadow-inner border border-[#e6d5b8]/50 scrollable-tabs">
            <button
              onClick={() => setActiveTab('pay')}
              className={`flex-shrink-0 whitespace-nowrap py-3 px-4 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all uppercase tracking-wide ${activeTab === 'pay' ? 'bg-[#e68a2e] text-white shadow-md' : 'text-[#825e43] hover:bg-[#e6d5b8]'}`}
            >
              <QrCode className="w-5 h-5" /> Bayar
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex-shrink-0 whitespace-nowrap py-3 px-4 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all uppercase tracking-wide ${activeTab === 'dashboard' ? 'bg-[#e68a2e] text-white shadow-md' : 'text-[#825e43] hover:bg-[#e6d5b8]'}`}
            >
              <LayoutDashboard className="w-5 h-5" /> Dasbor
            </button>
            <button
              onClick={() => setActiveTab('disbursement')}
              className={`flex-shrink-0 whitespace-nowrap py-3 px-4 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all uppercase tracking-wide ${activeTab === 'disbursement' ? 'bg-[#e68a2e] text-white shadow-md' : 'text-[#825e43] hover:bg-[#e6d5b8]'}`}
            >
              <ArrowLeftRight className="w-5 h-5" /> Pencairan
            </button>
          </div>

          {activeTab === 'disbursement' ? (
            <DisbursementManager onClose={() => setActiveTab('dashboard')} turnstileSiteKey={turnstileSiteKey} />
          ) : activeTab === 'pay' ? (
            <div className="p-6 sm:p-8 pt-2">
              {!orderId && !isSuccess && (
                <div className="space-y-6">
                  
                  {/* Step 1: Bean Selection */}
                  <div className="bg-white rounded-2xl p-5 border-2 border-[#e6d5b8] shadow-sm">
                    <label className="block text-sm font-extrabold text-[#825e43] mb-3 uppercase tracking-wide flex items-center gap-2">
                      <span className="bg-[#e68a2e] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
                      Pilih Biji Kopi
                    </label>
                    {beans.length === 0 ? (
                      <p className="text-[#825e43] font-bold text-sm text-center py-3 bg-[#f7ede1] rounded-xl">
                        {!pricing ? 'Memuat...' : 'Belum ada biji kopi — hubungi admin'}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {beans.filter(b => b.isActive).map(bean => (
                          <button
                            key={bean.slug}
                            onClick={() => {
                              setSelectedBeanSlug(bean.slug);
                              setGrams('');
                            }}
                            className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                              selectedBeanSlug === bean.slug
                                ? 'bg-[#fff8eb] border-[#e68a2e] shadow-md'
                                : 'bg-[#f7ede1] border-[#e6d5b8] hover:border-[#e68a2e]/50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {bean.imageUrl ? (
                                <img src={bean.imageUrl} alt={bean.name} className="w-12 h-12 rounded-lg object-cover border border-[#e6d5b8]" />
                              ) : (
                                <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border border-[#e6d5b8]">
                                  <Coffee className="w-6 h-6 text-[#825e43]" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-extrabold text-[#3b2313] text-sm truncate">{bean.name}</p>
                                {bean.description && (
                                  <p className="text-xs text-[#825e43] line-clamp-1 mt-0.5">{bean.description}</p>
                                )}
                                <p className="text-xs font-extrabold text-[#e68a2e] mt-1">
                                  Rp {bean.pricePer250g.toLocaleString('id-ID')} / 250g
                                </p>
                              </div>
                              {selectedBeanSlug === bean.slug && (
                                <div className="absolute top-2 right-2 w-5 h-5 bg-[#e68a2e] rounded-full flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl p-6 border-2 border-[#e6d5b8] shadow-sm relative overflow-hidden group hover:border-[#e68a2e]/50 transition-colors">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#f7ede1] rounded-bl-full -z-0 opacity-50 pointer-events-none transition-transform group-hover:scale-110"></div>
                    
                    <div className="relative z-10">
                      <label htmlFor="grams" className="block text-sm font-extrabold text-[#825e43] mb-3 uppercase tracking-wide flex items-center gap-2">
                        <span className="bg-[#e68a2e] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span> 
                        Input Gramasi
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          id="grams"
                          min="0"
                          step="0.1"
                          value={grams}
                          onChange={(e) => setGrams(e.target.value)}
                          className="w-full text-4xl font-extrabold text-[#3b2313] bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-4 px-4 pr-16 focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all text-center placeholder:text-[#dcbfa6]"
                          placeholder="0"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#825e43] font-bold text-xl">
                          g
                        </span>
                      </div>
                      <p className="text-xs font-bold text-[#825e43] mt-3 text-center bg-[#f7ede1] py-2 rounded-lg uppercase tracking-wide">
                        Harga: Rp {selectedBean ? selectedBean.pricePer250g.toLocaleString('id-ID') : pricing ? pricing.pricePer250g.toLocaleString('id-ID') : '...'} / 250g
                      </p>
                    </div>
                  </div>

                  <div className="bg-[#f7ede1] rounded-2xl p-5 border-2 border-[#e6d5b8] flex items-center justify-between shadow-inner">
                    <div className="flex items-center gap-2 text-[#825e43] font-extrabold uppercase tracking-wide text-sm">
                      <span className="bg-[#e68a2e] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span>
                      Total Bayar
                    </div>
                    <span className="text-3xl font-extrabold text-[#e68a2e]">
                      Rp {amount.toLocaleString('id-ID')}
                    </span>
                  </div>

                  {error && (
                    <div className="bg-[#fce8e6] text-[#d93025] p-4 rounded-xl font-bold text-sm flex items-start gap-2 border-2 border-[#d93025]/20">
                      <XCircle className="w-5 h-5 shrink-0" />
                      <p>{error}</p>
                    </div>
                  )}

                  {pricingError && (
                    <div className="bg-[#fce8e6] text-[#d93025] p-4 rounded-xl font-bold text-sm flex items-start gap-2 border-2 border-[#d93025]/20">
                      <XCircle className="w-5 h-5 shrink-0" />
                      <p>Error Harga: {pricingError}</p>
                    </div>
                  )}

                  {snapError && (
                    <div className="bg-[#fef7e0] text-[#e68a2e] p-4 rounded-xl font-bold text-sm flex items-start gap-2 border-2 border-[#e68a2e]/20">
                      <XCircle className="w-5 h-5 shrink-0" />
                      <p>Error Sistem: {snapError}</p>
                    </div>
                  )}

                  {turnstileSiteKey && (
                    <div className="flex justify-center mt-4">
                      <Turnstile siteKey={turnstileSiteKey} onSuccess={setTurnstileToken} />
                    </div>
                  )}

                  <button
                    onClick={handleGenerateQR}
                    disabled={loading || amount <= 0 || !snapReady || !pricing || !selectedBean || (!!turnstileSiteKey && !turnstileToken)}
                    className="w-full bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold text-lg py-5 rounded-xl shadow-xl shadow-[#e68a2e]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 uppercase tracking-wide border-b-[6px] border-[#b06a20] active:border-b-0 active:translate-y-[6px]"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Proses...
                      </>
                    ) : !pricing ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Loading Harga...
                      </>
                    ) : !snapReady ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" />
                        Loading Sistem...
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-6 h-6" />
                        Bayar
                      </>
                    )}
                  </button>
                </div>
              )}

              {orderId && !isSuccess && !isFailed && (
                <div className="flex flex-col items-center space-y-4 animate-in fade-in zoom-in duration-300">
                  <div className="text-center bg-[#f7ede1] px-6 py-3 rounded-2xl border-2 border-[#e6d5b8] w-full">
                    <h2 className="text-sm font-extrabold text-[#825e43] uppercase tracking-wide mb-1">Total Pembayaran</h2>
                    <p className="text-3xl font-extrabold text-[#e68a2e]">Rp {amount.toLocaleString('id-ID')}</p>
                  </div>
                  
                  <div className="w-full bg-white rounded-3xl shadow-sm border-[4px] border-[#e6d5b8] overflow-hidden relative">
                    <div id="snap-container" className="w-full min-h-[400px] flex items-center justify-center bg-white">
                      {!snapReady && (
                        <div className="text-center py-8">
                          <Loader2 className="w-10 h-10 animate-spin mx-auto text-[#e68a2e] mb-3" />
                          <p className="text-[#825e43] text-sm font-extrabold uppercase tracking-widest">Loading Qris...</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleCancelClick}
                    className="text-[#825e43] hover:text-[#d93025] text-sm font-extrabold transition-colors uppercase tracking-widest border-b-2 border-transparent hover:border-[#d93025] pb-1 pt-2"
                  >
                    Batalkan Transaksi
                  </button>
                </div>
              )}

              {isSuccess && (
                <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-500 py-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-[#1e8e3e] rounded-full animate-pulse-ring"></div>
                    <div className="w-24 h-24 bg-[#1e8e3e] rounded-full flex items-center justify-center text-white relative z-10 shadow-xl shadow-[#1e8e3e]/30 border-[6px] border-[#fff8eb]">
                      <CheckCircle2 className="w-12 h-12" />
                    </div>
                  </div>
                  <div className="text-center space-y-3">
                    <h2 className="text-3xl font-extrabold text-[#3b2313] uppercase tracking-widest">Berhasil!</h2>
                    <div className="inline-block bg-[#f7ede1] px-5 py-3 rounded-2xl border-2 border-[#e6d5b8]">
                      <p className="text-sm font-bold text-[#825e43] uppercase tracking-wide mb-1">Nominal Dibayar</p>
                      <p className="text-2xl font-extrabold text-[#e68a2e]">Rp {amount.toLocaleString('id-ID')}</p>
                    </div>
                    <p className="text-[#825e43] font-bold text-lg mt-2 font-serif italic">Nikmati Kopi Anda!</p>
                  </div>
                  <button
                    onClick={resetPayment}
                    className="w-full bg-[#4a2e1b] hover:bg-[#3b2313] text-white font-extrabold py-4 rounded-xl transition-all flex items-center justify-center gap-2 mt-4 uppercase tracking-wide shadow-lg border-b-[6px] border-[#2c1b10] active:border-b-0 active:translate-y-[6px]"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Selesai
                  </button>
                </div>
              )}

              {isFailed && (
                <div className="flex flex-col items-center space-y-6 animate-in fade-in zoom-in duration-300 py-6">
                  <div className="w-24 h-24 bg-[#fce8e6] rounded-full flex items-center justify-center text-[#d93025] border-4 border-[#d93025]/20">
                    <XCircle className="w-12 h-12" />
                  </div>
                  <div className="text-center space-y-2">
                    <h2 className="text-3xl font-extrabold text-[#3b2313] uppercase tracking-wide">Gagal</h2>
                    <p className="text-[#825e43] font-bold">Transaksi dibatalkan atau kadaluarsa.</p>
                  </div>
                  <button
                    onClick={resetPayment}
                    className="w-full bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold py-4 rounded-xl transition-all flex items-center justify-center gap-2 mt-4 uppercase tracking-wide shadow-lg border-b-[6px] border-[#b06a20] active:border-b-0 active:translate-y-[6px]"
                  >
                    Coba Lagi
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Dashboard onPayOrder={handlePayOrder} turnstileSiteKey={turnstileSiteKey} beans={beans} />
          )}
        </div>

        <div className="text-center pt-4 opacity-50 font-bold text-[#fdf4e3] uppercase tracking-widest text-sm flex items-center justify-center gap-2">
          <Coffee className="w-4 h-4" /> Kopi Kita
        </div>
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-[#4a2e1b]/80 backdrop-blur-sm transition-opacity"
            onClick={handleCloseCancelModal}
          />
          
          <div className="relative bg-[#fff8eb] rounded-[2rem] shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200 border-[4px] border-[#e6d5b8]">
            <div className="w-20 h-20 bg-[#fef7e0] rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-[#e68a2e]/20">
              <XCircle className="w-10 h-10 text-[#e68a2e]" />
            </div>
            
            <h3 className="text-2xl font-extrabold text-[#3b2313] text-center mb-2 uppercase tracking-wide">
              Batal Transaksi?
            </h3>
            
            <div className="text-center mb-6 bg-white p-4 rounded-2xl border-2 border-[#e6d5b8]">
              <p className="text-[#825e43] font-bold text-sm uppercase mb-1">Total</p>
              <p className="text-2xl font-extrabold text-[#e68a2e]">
                Rp {amount.toLocaleString('id-ID')}
              </p>
            </div>
            
            <div className="bg-[#fce8e6] border-2 border-[#d93025]/20 rounded-xl p-4 mb-6">
              <p className="text-xs font-bold text-[#d93025] text-center uppercase tracking-wide">
                Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            
            {cancelError && (
              <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl text-sm mb-4 font-bold text-center">
                {cancelError}
              </div>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={handleCloseCancelModal}
                disabled={cancelling}
                className="flex-1 bg-white border-2 border-[#e6d5b8] hover:bg-[#f7ede1] text-[#825e43] font-extrabold py-3 rounded-xl transition-all disabled:opacity-50 uppercase tracking-wide"
              >
                Kembali
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="flex-1 bg-[#d93025] hover:bg-[#b3261e] text-white font-extrabold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-wide shadow-lg"
              >
                {cancelling ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Ya, Batal'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}