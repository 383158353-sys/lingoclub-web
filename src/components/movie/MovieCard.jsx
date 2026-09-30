import React from "react";
import { Link } from "react-router-dom";
import { Image } from "@/components/ui/image";
import DifficultyBadge from "@/components/common/DifficultyBadge";

export default function MovieCard({ movie, index = 0, to }) {
  return (
    <Link
      to={to || `/movie/${movie.id}`}
      className="group block animate-fade-up"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="overflow-hidden rounded-xl border border-white/10 bg-card transition-colors duration-300 group-hover:border-mint/50">
        <div className="relative aspect-video overflow-hidden">
          <Image
            src={movie.backdrop_url || movie.poster_url}
            alt={movie.title}
            fittingType="fill"
            className="h-full w-full transition-transform duration-700 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          <div className="absolute left-2 top-2">
            <DifficultyBadge level={movie.difficulty} />
          </div>
        </div>
      </div>
      <div className="mt-1.5 px-0.5 md:mt-2">
        <p className="font-display text-xs font-semibold leading-tight text-foreground line-clamp-1 md:text-sm">{movie.title}</p>
        {movie.tagline && <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground md:text-[11px]">{movie.tagline}</p>}
      </div>
    </Link>
  );
}
