import React, { useState, useEffect } from 'react';
import { Coffee, Plus, LogOut, Loader2, X, Check, Edit3, Trash2, LayoutDashboard, ArrowLeft, ArrowLeftRight, CheckCircle2, XCircle } from 'lucide-react';

export default function Admin() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('admin_token'));
  const [beans, setBeans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingBean, setEditingBean] = useState<any | null>(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formPrice, setFormPrice] = useState('100000');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [disbursements, setDisbursements] = useState<any[]>([]);
  const [disbursementsLoading, setDisbursementsLoading] = useState(false);
  const [disbursementAction, setDisbursementAction] = useState<string | null>(null);

  useEffect(() => {
    if (token) fetchBeans();
  }, [token]);

  useEffect(() => {
    if (token) fetchDisbursements();
  }, [token]);

  const fetchBeans = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/beans', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        sessionStorage.removeItem('admin_token');
        setToken(null);
        return;
      }
      const data = await res.json();
      if (res.ok) {
        setBeans(data);
      } else {
        setError(data.error);
      }
    } catch {
      setError('Failed to fetch beans');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();
      if (res.ok) {
        sessionStorage.setItem('admin_token', data.token);
        setToken(data.token);
        setLoginEmail('');
        setLoginPassword('');
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch {
      setLoginError('Network error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    setToken(null);
    setBeans([]);
  };

  const openAddForm = () => {
    setEditingBean(null);
    setFormName('');
    setFormSlug('');
    setFormDescription('');
    setFormImageUrl('');
    setFormPrice('100000');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (bean: any) => {
    setEditingBean(bean);
    setFormName(bean.name);
    setFormSlug(bean.slug);
    setFormDescription(bean.description || '');
    setFormImageUrl(bean.imageUrl || '');
    setFormPrice(bean.pricePer250g.toString());
    setFormError(null);
    setShowForm(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      const body = {
        name: formName,
        slug: formSlug,
        description: formDescription || null,
        imageUrl: formImageUrl || null,
        pricePer250g: parseInt(formPrice)
      };

      const url = editingBean
        ? `/api/admin/beans/${editingBean.id}`
        : '/api/admin/beans';
      const method = editingBean ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (res.ok) {
        setShowForm(false);
        fetchBeans();
      } else {
        setFormError(data.error || 'Failed to save bean');
      }
    } catch {
      setFormError('Network error');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (bean: any) => {
    if (!confirm(`Hapus "${bean.name}"? Bean akan dinonaktifkan.`)) return;
    try {
      const res = await fetch(`/api/admin/beans/${bean.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        fetchBeans();
      }
    } catch {
      setError('Failed to delete bean');
    }
  };

  const autoGenerateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  };

  const handleNameChange = (name: string) => {
    setFormName(name);
    if (!editingBean) {
      setFormSlug(autoGenerateSlug(name));
    }
  };

  const fetchDisbursements = async () => {
    setDisbursementsLoading(true);
    try {
      const res = await fetch('/api/disbursements');
      const data = await res.json();
      if (res.ok) setDisbursements(data);
    } catch {} finally {
      setDisbursementsLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setDisbursementAction(requestId);
    try {
      const res = await fetch(`/api/disbursements/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDisbursements(disbursements.map(d => d.requestId === requestId ? data.disbursement : d));
      }
    } catch {} finally {
      setDisbursementAction(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setDisbursementAction(requestId);
    try {
      const res = await fetch(`/api/disbursements/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setDisbursements(disbursements.map(d => d.requestId === requestId ? data.disbursement : d));
      }
    } catch {} finally {
      setDisbursementAction(null);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#4a2e1b] flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-[#fff8eb] rounded-[2rem] shadow-2xl overflow-hidden border-b-8 border-[#e6d5b8]">
          <div className="p-6 sm:p-8">
            <div className="text-center space-y-2 mb-6">
              <div className="w-16 h-16 bg-[#e68a2e] rounded-full flex items-center justify-center mx-auto shadow-lg">
                <Coffee className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-extrabold text-[#3b2313] uppercase tracking-widest">Admin</h1>
              <p className="text-sm font-bold text-[#825e43]">Masuk untuk mengelola biji kopi</p>
            </div>

            {loginError && (
              <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl font-bold text-sm mb-4 text-center border-2 border-[#d93025]/20">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  placeholder="admin@kopi-kita.com"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className="w-full bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold py-4 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-wide"
              >
                {loginLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Masuk'}
              </button>
            </form>

            <a
              href="/"
              className="block text-center mt-4 text-[#825e43] font-bold text-sm hover:text-[#e68a2e] transition-colors uppercase tracking-wide"
            >
              ← Kembali ke Beranda
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#4a2e1b] p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-[#fff8eb] rounded-[2rem] shadow-2xl overflow-hidden border-b-8 border-[#e6d5b8]">
          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#e68a2e] rounded-full flex items-center justify-center shadow-lg">
                  <Coffee className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold text-[#3b2313] uppercase tracking-widest">Admin</h1>
                  <p className="text-xs font-bold text-[#825e43]">Kelola Biji Kopi</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="/"
                  className="bg-[#f7ede1] hover:bg-[#e6d5b8] text-[#825e43] font-bold p-3 rounded-xl transition-all"
                >
                  <ArrowLeft className="w-5 h-5" />
                </a>
                <button
                  onClick={handleLogout}
                  className="bg-[#fce8e6] hover:bg-[#f8d7da] text-[#d93025] font-bold p-3 rounded-xl transition-all"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl font-bold text-sm mb-4 border-2 border-[#d93025]/20">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <h2 className="font-extrabold text-[#825e43] uppercase tracking-wider text-sm flex items-center gap-2">
                <LayoutDashboard className="w-4 h-4 text-[#e68a2e]" />
                Daftar Biji Kopi
              </h2>
              <button
                onClick={openAddForm}
                className="bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold text-sm py-2.5 px-4 rounded-xl transition-all shadow-md flex items-center gap-2 uppercase tracking-wide"
              >
                <Plus className="w-4 h-4" />
                Tambah
              </button>
            </div>

            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#e68a2e]" />
              </div>
            ) : beans.length === 0 ? (
              <div className="bg-[#f7ede1] border-2 border-dashed border-[#e6d5b8] rounded-2xl p-8 text-center">
                <p className="text-[#825e43] font-bold">Belum ada biji kopi</p>
                <p className="text-[#825e43] text-sm mt-1">Klik "Tambah" untuk menambahkan biji kopi pertama</p>
              </div>
            ) : (
              <div className="space-y-3">
                {beans.map(bean => (
                  <div
                    key={bean.id}
                    className={`bg-white border-2 rounded-xl p-4 flex items-center gap-4 transition-all ${bean.isActive ? 'border-[#e6d5b8]' : 'border-[#fce8e6] opacity-60'}`}
                  >
                    {bean.imageUrl ? (
                      <img src={bean.imageUrl} alt={bean.name} className="w-14 h-14 rounded-xl object-cover border border-[#e6d5b8] shrink-0" />
                    ) : (
                      <div className="w-14 h-14 bg-[#f7ede1] rounded-xl flex items-center justify-center border border-[#e6d5b8] shrink-0">
                        <Coffee className="w-6 h-6 text-[#825e43]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-extrabold text-[#3b2313]">{bean.name}</h3>
                        {!bean.isActive && (
                          <span className="text-[10px] bg-[#fce8e6] text-[#d93025] px-2 py-0.5 rounded-full font-extrabold uppercase">Nonaktif</span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-[#825e43]">Slug: {bean.slug}</p>
                      {bean.description && <p className="text-xs text-[#825e43] mt-1 line-clamp-1">{bean.description}</p>}
                      <p className="text-sm font-extrabold text-[#e68a2e] mt-1">Rp {bean.pricePer250g.toLocaleString('id-ID')} / 250g</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEditForm(bean)}
                        className="bg-[#f7ede1] hover:bg-[#e6d5b8] text-[#825e43] p-2 rounded-xl transition-all"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(bean)}
                        className="bg-[#fce8e6] hover:bg-[#f8d7da] text-[#d93025] p-2 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Disbursement Section */}
            <div className="mt-8 pt-8 border-t-2 border-[#e6d5b8]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-extrabold text-[#825e43] uppercase tracking-wider text-sm flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-[#e68a2e]" />
                  Permintaan Pencairan
                </h2>
              </div>

              {disbursementsLoading ? (
                <div className="py-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#e68a2e]" />
                </div>
              ) : disbursements.length === 0 ? (
                <p className="text-[#825e43] text-sm text-center py-6 font-bold bg-[#e6d5b8]/20 rounded-2xl border-2 border-dashed border-[#e6d5b8]">
                  Belum ada permintaan pencairan
                </p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {disbursements.map((disb) => (
                    <div
                      key={disb.requestId}
                      className="bg-white border-2 border-[#e6d5b8] rounded-xl p-4"
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
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(disb.requestId)}
                            disabled={disbursementAction === disb.requestId}
                            className="flex-1 bg-[#e6f4ea] hover:bg-[#1e8e3e] text-[#1e8e3e] hover:text-white font-bold py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {disbursementAction === disb.requestId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <><CheckCircle2 className="w-4 h-4" /> Setuju</>
                            )}
                          </button>
                          <button
                            onClick={() => handleReject(disb.requestId)}
                            disabled={disbursementAction === disb.requestId}
                            className="flex-1 bg-[#fce8e6] hover:bg-[#d93025] text-[#d93025] hover:text-white font-bold py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {disbursementAction === disb.requestId ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <><XCircle className="w-4 h-4" /> Tolak</>
                            )}
                          </button>
                        </div>
                      )}

                      {disb.status !== 'pending' && disb.processedAt && (
                        <p className="text-[10px] text-[#825e43] font-bold mt-2 uppercase tracking-wide">
                          Diproses: {new Date(disb.processedAt).toLocaleDateString('id-ID')} oleh {disb.processedBy}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-[#4a2e1b]/80 backdrop-blur-sm"
            onClick={() => setShowForm(false)}
          />
          <div className="relative bg-[#fff8eb] rounded-[2rem] shadow-2xl w-full max-w-lg p-6 border-[4px] border-[#e6d5b8] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-extrabold text-[#3b2313] uppercase tracking-wide">
                {editingBean ? 'Edit Biji Kopi' : 'Tambah Biji Kopi'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="bg-[#f7ede1] hover:bg-[#e6d5b8] text-[#825e43] p-2 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="bg-[#fce8e6] text-[#d93025] p-3 rounded-xl font-bold text-sm mb-4 text-center border-2 border-[#d93025]/20">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Nama *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => handleNameChange(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  placeholder="Arabika Gayo"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Slug *</label>
                <input
                  type="text"
                  value={formSlug}
                  onChange={e => setFormSlug(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  placeholder="arabika-gayo"
                  required
                />
                <p className="text-[10px] font-bold text-[#825e43] mt-1">URL-friendly identifier, e.g. arabika-gayo</p>
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Deskripsi</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all resize-none"
                  placeholder="Deskripsi singkat tentang biji kopi..."
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">URL Gambar</label>
                <input
                  type="url"
                  value={formImageUrl}
                  onChange={e => setFormImageUrl(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  placeholder="https://example.com/coffee.jpg"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#825e43] mb-2 uppercase tracking-wide">Harga per 250g (Rp) *</label>
                <input
                  type="number"
                  value={formPrice}
                  onChange={e => setFormPrice(e.target.value)}
                  className="w-full bg-[#f7ede1] border-2 border-[#e6d5b8] rounded-xl py-3 px-4 font-bold text-[#3b2313] focus:outline-none focus:border-[#e68a2e] focus:bg-white transition-all"
                  min="0"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-white border-2 border-[#e6d5b8] hover:bg-[#f7ede1] text-[#825e43] font-extrabold py-3 rounded-xl transition-all uppercase tracking-wide"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 bg-[#e68a2e] hover:bg-[#c97a29] text-white font-extrabold py-3 rounded-xl transition-all shadow-md disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-wide"
                >
                  {formLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : editingBean ? (
                    <>
                      <Check className="w-5 h-5" />
                      Simpan
                    </>
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      Tambah
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
