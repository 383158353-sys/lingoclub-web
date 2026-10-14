import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { listLibraryArticles } from "@/lib/libraryArticles";
import { articleDomain } from "@/lib/dailyArticlesFormat";

export default function LibraryArticleList({ onImport }) {
 const { user } = useAuth();
 const [rows,setRows]=useState([]), [loading,setLoading]=useState(true), [error,setError]=useState(''), [refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;setRows([]);setLoading(true);setError('');if(!user){setLoading(false);return;}listLibraryArticles().then(data=>{if(active)setRows(data)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[user?.id,refresh]);
 return <section className="mt-6"><div className="mb-5 flex gap-4"><button type="button" onClick={onImport} className="min-h-11 rounded-full bg-copper px-5 text-sm text-copper-foreground">导入文章</button><button type="button" onClick={()=>setRefresh(n=>n+1)} className="text-sm text-muted-foreground">刷新</button></div>
 {!user?<p>登录后可导入并阅读自己的文章。<Link to="/login" className="ml-2 text-copper">登录</Link></p>:loading?<p>正在加载文章…</p>:error?<p role="alert">加载失败：{error}</p>:!rows.length?<p className="py-12 text-center text-muted-foreground">还没有学习文章。粘贴链接和英文正文，开始精读吧。</p>:<div className="space-y-4">{rows.map(row=><Link key={row.id} to={`/library-articles/${row.id}`} className="block rounded-2xl border border-border bg-card p-5"><h2 className="text-lg">{row.title}</h2><p className="mt-2 text-xs text-muted-foreground">{row.outlet||articleDomain(row.source_url)} · {row.level} · {row.read_at?'已读':'未读'}</p>{row.summary_zh&&<p className="mt-3 text-sm text-muted-foreground">{row.summary_zh}</p>}</Link>)}</div>}
 </section>;
}
