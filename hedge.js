"use strict";

function talmud(src, dst, stake)
{
	const sell = stake * src / (1 + stake);
	const buy = stake * dst / (1 - stake);
	const ratio = (1 - sell / src) * (1 + buy / dst);

	return {
		stake: stake,
		price: buy / sell,
		sell: sell,
		buy: buy,
		ratio: ratio
	};
}

function decide(entry)
{
	const need = entry.need;
	const proper = entry.proper;
	const offer = entry.offer;
	const active = entry.active.sort((a, b) => {
		if (a.ratio < b.ratio)
			return -1;
		else
			return 1;
	});
	const best = active.pop();

	entry.best = best;
	entry.rest = active;

	if (!best && need)
		return "absent";

	if (best) {
		const ratio = best.ratio;
		const delta = best.price / proper.price - 1;

		offer.ratio = ratio;
		offer.delta = delta;
		offer.seq = best.seq;
		offer.old = best.human;

		if (ratio < Math.sqrt(proper.ratio)) {
			if (need)
				return "bad";
			else
				return "zombie";
		}

		if (delta > proper.stake)
			if (need)
				return "far";
	}
}

exports.command = "hedge <me>";
exports.desc = "Apply the Talmud strategy";
exports.aliases = [
	"run",
	"talmud"
];
exports.builder = yargs => yargs;
exports.handler = connect((config, xmm) => {
	const id = xmm.parse(config.me);
	// console.log('start', config);

	const me = id.human;
	const wallet = id.wallet;
	const ledger = config.ledger;
	const cancel = (p, offer) => p.then(() => {
		return xmm.cancel(offer).then(print);
	});
	const create = (p, offer) => p.then(() => {
		return xmm.create(offer).then((data) => {
			// console.log('create ok~!');
			print(data);
			return data;
		}).catch((error) => {
			console.log('create error', error.message, error.stack);
		});
		// .then((data) => {
		// 	print(data);
		// 	console.log(data);
		// 	return data;
		// });
	});
	const select = (offers, saldo) => {
		const all = Object.keys(saldo);
		const pairs = config.hedge.map(pair => {
			const list = pair.split("/");

			if (1 == list.length)
				list.push(list[0]);

			return list.map(assets => {
				if ("*" == assets)
					return all;

				assets = assets.split(",");
				return assets.map(asset => {
					asset = `${asset}@${me}`;
					asset = xmm.parse(asset);
					return asset.human;
				});
			});
		}).reduce((list, pair) => {
			while (pair.length >= 2) {
				list.push(pair.slice(0, 2));
				pair.shift();
			}

			return list;
		}, []).reduce((list, pair) => {
			const left = pair.shift();
			const right = pair.shift();

			left.forEach(a => {
				right.forEach(b => {
					list.push(`${a}/${b}`);
					list.push(`${b}/${a}`);
				});
			});
			return list;
		}, []);

		pairs.forEach(pair => {
			const offer = offers[pair];

			if (offer)
				offer.need = true;
		});
	};
	const getoffer = (entry) => {
		const proper = entry.proper;
		const src = xmm.parse(entry.src);
		const dst = xmm.parse(entry.dst);

		return xmm.parse({
			type: "offer",
			base: src.asset,
			asset: dst.asset,
			value: proper.buy,
			cost: proper.sell,
			wallet: wallet
		});
	};
	const compute = (saldo) => {
		const assets = Object.keys(saldo);
		const stake = config.delta;
		const offers = {};

		assets.forEach(base => {
			assets.forEach(asset => {
				const pair = `${asset}/${base}`;
				const src = saldo[base];
				const dst = saldo[asset];
				let proper, offer, entry;

				if (asset == base)
					return;

				proper = talmud(src, dst, stake);

				entry = {
					src: base,
					dst: asset,
					proper: proper,
					active: []
				};
				entry.offer = getoffer(entry);
				offers[pair] = entry;
			});
		});

		select(offers, saldo);
		return offers;
	};
	const dryrun = (zombie, bad, absent, far) => {
		const drykill = (offer) => {
			console.info("kill", offer.human);
		};
		const dryoffer = (offer) => {
			console.info("offer", offer.human);
		};

		console.info("# zombie");
		zombie.forEach(drykill);

		console.info("# bad");
		bad.forEach(dryoffer);

		console.info("# absent");
		absent.forEach(dryoffer);

		console.info("# far");
		far.forEach(dryoffer);
	};
	const sequence = (zombie, bad, absent, far) => {
		let script = Promise.resolve();
		let safe;

		script = zombie.reduce(cancel, script);
		script = bad.reduce(create, script);

		if (zombie.length || bad.length)
			return script;
		// console.log(absent.length);

		safe = absent.concat(far).slice(0, 1);
		return safe.reduce(create, script);
	};

	let tasks = [
		xmm.balance(me, ledger),
		xmm.offers(me, ledger)
	];
	let taskOrderBook = [];
	for (let key in config.assets) {
		let asset = config.assets[key];
		taskOrderBook.push(xmm.orderBook(me, {
			"currency": asset.code,
			"counterparty": asset.issuer
		}, { limit: 2 }));
	}
	tasks.push(Promise.all(taskOrderBook));
	Promise.all(tasks).then(state => {
		const saldo = {};
		const zombie = [];
		const bad = [];
		const absent = [];
		const far = [];
		let offers;

		state[0].forEach(line => {
			const value = line.value;

			if (value > 0) {
				const asset = xmm.parse({
					type: "asset",
					asset: line.asset,
					wallet: wallet
				}).human;

				saldo[asset] = value;
				return true;
			}
		});


		let ts = {}, p = {};
		for (let i = 0; i < state[2].length; i++) {
			let item = state[2][i], bidOne = item.bids[0];
			if (bidOne) {
				let spec = bidOne.specification;
				ts[spec.totalPrice.currency] = spec.totalPrice.value / spec.quantity.value;
			}
		}

		let k = 0;
		for (let key in saldo) {
			let code = key.substr(0, 3);
			if (code == 'XRP') {
				ts[code] = 1;
			}
			if (typeof ts[code] == 'undefined') {
				console.log('k error', key, ts);
			} else {
				k += saldo[key] / ts[code];
				p[code] = saldo[key] / ts[code] / saldo['XRP@fund'];
			}
		}

		console.log('☆☆☆☆☆ start', me,
			'balance Count:', state[0].length,
			'offers Count:', state[1].length, JSON.stringify(saldo), JSON.stringify(ts), 'k:', k);
		console.log(JSON.stringify(p));

		if (k < 600) {
			console.log('哎！');
			process.exit();
		}
		// process.exit();

		offers = compute(saldo);
		// console.log(offers);
		state[1].forEach(line => {
			const src = xmm.parse({
				type: "asset",
				asset: line.base,
				wallet: wallet
			}).human;
			const dst = xmm.parse({
				type: "asset",
				asset: line.asset,
				wallet: wallet
			}).human;
			const pair = offers[`${dst}/${src}`];
			let ratio = 1;

			if (!pair)
				return;

			ratio *= 1 - line.cost / saldo[src];
			ratio *= 1 + line.value / saldo[dst];
			line.ratio = ratio;

			pair.active.push(line);
		});

		for (const pair in offers) {
			const entry = offers[pair];
			const status = decide(entry);
			// console.log(status, pair, entry);

			if ("zombie" == status)
				zombie.push(entry.best);

			if ("bad" == status)
				bad.push(entry.offer);

			if ("absent" == status)
				absent.push(entry.offer);

			if ("far" == status)
				far.push(entry.offer);

			zombie.push.apply(zombie, entry.rest);
		}

		bad.sort((a, b) => a.ratio - b.ratio);
		far.sort((a, b) => b.delta - a.delta);

		if (config.dry) {
			dryrun(zombie, bad, absent, far);
			process.exit();
		}

		if (bad.length) {
			console.log('!!!!!!!!', bad.length);
		}

		// process.exit();

		sequence(zombie, bad, absent, far).then(() => {
			process.exit();
		}).catch(abort);
	}).catch(abort);
});
