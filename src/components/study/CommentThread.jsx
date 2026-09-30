import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Send, MessageSquare, Clock } from "lucide-react";

// Discussion thread bound to a scene (and a timestamp passed through).
export default function CommentThread({ movieId, movieTitle, sceneId, timestamp }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await base44.entities.Comment.filter({ scene_id: sceneId }, "-created_date", 50);
      setComments(list || []);
    } finally {
      setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    setPosting(true);
    try {
      const me = await base44.auth.me().catch(() => null);
      const created = await base44.entities.Comment.create({
        movie_id: movieId,
        movie_title: movieTitle,
        scene_id: sceneId,
        timestamp: timestamp || "",
        content: content.trim(),
        author_name: me?.full_name || me?.email || "匿名影迷",
        likes: 0,
      });
      setComments((c) => [created, ...c]);
      setContent("");
    } catch (err) {
      toast({ title: "发布失败", description: err.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="mt-10 border-t border-border/60 pt-8">
      <h3 className="font-display text-xl flex items-center gap-2"><MessageSquare size={18} className="text-copper" /> 场景讨论 <span className="text-sm font-body text-muted-foreground">· {comments.length}</span></h3>
      <form onSubmit={submit} className="mt-4">
        <div className="flex items-center gap-2 rounded-full border border-copper/40 bg-copper/5 px-3 py-1 text-xs text-copper w-fit">
          <Clock size={12} /> 绑定时间 {timestamp || "本场景"}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="分享你对这段表演、台词或文化的理解…"
          className="mt-3 w-full resize-none rounded-xl border border-border bg-background-elev/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-copper/50 focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={posting || !content.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-copper px-5 py-2 text-sm font-medium text-copper-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
          >
            <Send size={14} /> {posting ? "发布中…" : "发布评论"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="mt-6 text-sm text-muted-foreground">加载讨论…</p>
      ) : comments.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          还没有人讨论这段。做第一个开口的人吧。
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-border/60 bg-background-elev/30 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="text-copper/90">{c.author_name || "匿名影迷"}</span>
                <span className="flex items-center gap-1.5"><Clock size={10} /> {new Date(c.created_date).toLocaleDateString("zh-CN")}</span>
              </div>
              {c.timestamp && <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-mahogany/60 px-2 py-0.5 text-[10px] text-copper/80">{c.timestamp}</span>}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{c.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}