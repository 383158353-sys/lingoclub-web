import React from 'react';
import { Link } from 'react-router-dom';
import { Users, Star } from 'lucide-react';
import Image from '@/components/ui/image';
import { difficultyLabel, difficultyColor, categoryLabel } from '@/lib/srs';

export default function MovieCard({ movie, index = 0 }) {
  return (
    <Link
      to={`/movie/${movie.id}`}
      className="group block animate-float-up"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className="block stroke-frame relative rounded-xl overflow-hidden bg-card border border-border/60">
        <div className="relative aspect-[3/4] overflow-hidden">
          {movie.poster_url ? (
            <Image
              src={movie.poster_url}
              alt={movie.title}
              fittingType="fill"
              className="w-full h-full transition-transform duration-700 group-hover:scale-[1.06]"
            />
          ) : (
            <div className="w-full h-full bg-secondary" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
          <span className={`absolute top-3 left-3 text-[11px] tracking-widest uppercase ${difficultyColor(movie.difficulty)}`}>
            {difficultyLabel(movie.difficulty)}
          </span>
          <span className="absolute top-3 right-3 text-[11px] px-2 py-0.5 rounded-full bg-background/60 backdrop-blur border border-border/60 text-foreground/70">
            {categoryLabel(movie.category)}
          </span>
        </div>

        <span className="block p-4">
          <h3 className="font-display text-lg leading-tight text-foreground group-hover:text-primary transition-colors">
            {movie.title}
          </h3>
          {movie.title_en && (
            <p className="text-xs tracking-[0.15em] text-foreground/45 mt-0.5">{movie.title_en}</p>
          )}
          <p className="text-xs text-foreground/55 mt-2.5 line-clamp-2 leading-relaxed">
            {movie.synopsis}
          </p>

          <span className="flex items-center justify-between mt-4 pt-3 border-t border-border/40 text-[11px] text-foreground/50">
            <span className="flex items-center gap-1.5">
              <Users size={12} /> {(movie.member_count || 0).toLocaleString()}
            </span>
            {movie.rating > 0 && (
              <span className="flex items-center gap-1 text-primary/80">
                <Star size={12} /> {movie.rating.toFixed(1)}
              </span>
            )}
          </span>
        </span>
      </span>
    </Link>
  );
}