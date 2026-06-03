-- Add CANCELLED variant to the TradeStatus enum.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction on PostgreSQL < 12.
-- Railway uses PostgreSQL 14+, so this is safe in Prisma's default transactional
-- migration wrapper. The value is additive and non-destructive.
ALTER TYPE "TradeStatus" ADD VALUE 'CANCELLED';
