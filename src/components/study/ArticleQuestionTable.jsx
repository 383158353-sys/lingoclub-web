import React from "react";

export default function ArticleQuestionTable({ table }) {
  if (!table?.rows?.length) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      {table.caption && <p className="mb-2 text-sm text-muted-foreground">{table.caption}</p>}
      <table className="w-full min-w-[20rem] border-collapse text-sm md:text-base">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  colSpan={cell.colspan || 1}
                  rowSpan={cell.rowspan || 1}
                  className="border border-border/80 px-3 py-2 align-top"
                >
                  {cell.blank ? (
                    <span className="inline-flex min-h-8 min-w-[4.5rem] items-end border-b border-foreground/40 px-1">
                      {cell.number && <span className="mr-1 text-xs text-copper">{cell.number}</span>}
                      <span className="text-muted-foreground">{cell.text}</span>
                    </span>
                  ) : cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
