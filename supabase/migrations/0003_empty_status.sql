-- "Failed" must mean a genuine pipeline error — an upload that broke, a
-- worker crash, an API that rejected us. A huddle where nobody said anything
-- is not a failure, and conflating the two makes the failed signal useless
-- for debugging.
--
-- Run this statement on its own. Postgres will not let a newly added enum
-- value be used in the same transaction that adds it.

alter type meeting_status add value if not exists 'empty';
