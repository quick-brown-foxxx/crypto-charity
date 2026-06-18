# Initial Voice Note (English translation)

> The original Russian voice note is preserved in the conversation history.
> This file is the English version of the original idea, captured before any
> structured discussion. See `2026-06-14-crypto-charity-vault.md` for the
> refined concept and decisions that came out of the ideation session.

## The idea

I want to make a small — for the start — charity service that will scale later
and gain more features. The idea is to help people who lack the opportunity and
the money to get adequate, quality psychiatric and psychological help. Deliver
it by distributing paid sessions with a psychologist on online services like
Alter (ru). Maybe later psychiatry too, but for the start this is enough.

## How it will work

The economic core is cryptocurrencies — a specific wallet, an account, or
several wallets/accounts that receive money like USDT. Donors can transparently
see how much money comes in and when, and then transparently see how much goes
out and when. From the crypto money, through a number of services that provide
such services, gift cards are purchased for sites like Alter. In case gift
cards can't be bought directly with crypto, then bought through various
Telegram services that allow converting cryptocurrencies directly into dollar
bank cards or even paying via SBP (Russian fast payment system). In general,
there are many ways to pay for real services with crypto.

## Legality

Legality of all this is the next step. First we need to build the MVP, and
then later legal support will be worked out. This is handled by a separate
team, not me for now. My scope is purely the business idea and technology.

## Visual model

So again, visually you can imagine it like a git history — a tree — where
there are branches of incoming transactions and branches of outgoing
transactions. So that it's clear that outgoing money is not just withdrawn
somewhere, every withdrawal is attached with a payment receipt, possibly in
some anonymized form. For now that's it. In the future, of course, there can
be some clever automation and so on, but initially I'll be doing all this
manually. The site is needed just as a nice way to view the history.

## Scaling for now

At the early stage it's just a few people who can be brought in as
beneficiaries, just by personal acquaintance. Then a referral system. One
beneficiary invites another beneficiary. They have one invitation per month.
Or N invitations per month, depending on budget. To keep receiving support,
you need to invite people. Within budget, of course.

## Anonymity

Anonymity is very important.

- **Donors:** obviously, just a transfer to the account.
- **Beneficiaries:** harder. Need to think about MVP and production. The
  simplest non-anonymous way is of course just a Telegram bot, which may be
  a satisfactory compromise in some cases. Maybe email. Need to think.
  Ideally — integration with something like Matrix (the protocol — modern
  anonymous messenger). Maybe build some own simple window.

## Abuse protection

At the early stage: none. At later stages: via referrals.

## How I see the MVP stage

- A backend that handles wallet integration. Probably Solana to start.
  Solana+USDC, maybe USDT.
- A frontend that lets you beautifully view transactions. Something like a
  landing page.
- The ability for donors to donate money.
- A manual mechanism for withdrawing money and turning it into gift cards
  and other vouchers for beneficiaries.

Ideally we need to figure out how to automate, robotize, and anonymize the
service of interacting with beneficiaries. A Telegram bot or something else.
