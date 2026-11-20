// Prints the production seed SQL; never connects to a database (see README, "Seed production").
import { buildSeedSql } from '@/db/seed-sql'

process.stdout.write(buildSeedSql())
