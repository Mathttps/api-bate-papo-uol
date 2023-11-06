import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs';

const app = express();
dotenv.config();
app.use(cors());
app.use(express.json());

const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;

(async () => {
    try {
        await mongoClient.connect();
        db = mongoClient.db(); 
    } catch (err) {
        console.log(err);
    }
})();

const schemaName = joi.object({
    name: joi.string().required()
});

const schemaMessage = joi.object({
    to: joi.string().required(),
    text: joi.string().required(),
    type: joi.string().valid('message', 'private_message').required()
});

const now = () => dayjs().format('HH:mm:ss');

app.post("/participants", async (req, res) => {
    const { body } = req;
    const validation = schemaName.validate(body, { abortEarly: false });

    if (validation.error) {
        const errors = validation.error.details.map(d => d.message);
        res.status(422).send(errors);
        return;
    }

    try {
        const existingUser = await db
            .collection("participants")
            .findOne({ name: body.name });

        if (existingUser) {
            res.status(409).send("Nome de usuário indisponível");
            return;
        }

        const user = {
            name: body.name,
            lastStatus: Date.now()
        };
        const message = {
            from: body.name,
            to: 'Todos',
            text: 'entra na sala...',
            type: 'status',
            time: now()
        };

        await db.collection("participants").insertOne(user);
        await db.collection("messages").insertOne(message);
        res.sendStatus(201);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.get("/participants", async (req, res) => {
    try {
        const participants = await db.collection("participants").find().toArray();
        res.send(participants);
    } catch (err) {
        console.log(err);
        res.sendStatus(500);
    }
});

app.post("/messages", async (req, res) => {
    const { body } = req;
    const user = req.headers.user;
    const validation = schemaMessage.validate(body, { abortEarly: false });

    if (validation.error) {
        const errors = validation.error.details.map(d => d.message);
        res.status(422).send(errors);
        return;
    }

    try {
        const existingUser = await db.collection("participants").findOne({ name: user });
        if (!existingUser) {
            res.status(422).send("Remetente não encontrado");
            return;
        }

        const message = {
            from: user,
            to: body.to,
            text: body.text,
            type: body.type,
            time: now()
        };

        await db.collection("messages").insertOne(message);
        res.sendStatus(201);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.get("/messages", async (req, res) => {
    const limit = req.query.limit;
    const user = req.headers.user;

    if (limit !== undefined && (!Number.isInteger(+limit) || +limit < 1)) {
        res.status(422).send("O parâmetro 'limit' deve ser um número inteiro maior ou igual a 1.");
        return;
    }

    try {
        const query = {
            $or: [{ to: user }, { to: "Todos" }, { from: user }]
        };

        const messages = await db
            .collection("messages")
            .find(query)
            .toArray();

        if (limit === undefined) {
            res.send(messages);
        } else {
            // Converte o 'limit' para um número inteiro positivo.
            const limitInt = +limit;

            res.send(messages.slice(-limitInt));
        }
    } catch (err) {
        console.log(err);
        res.sendStatus(500);
    }
});

app.post("/status", async (req, res) => {
    const user = req.headers.user;

    try {
        const userOn = await db.collection("participants").findOne({ name: user });

        if (!userOn) {
            res.sendStatus(404);
            return;
        }

        await db.collection("participants").updateOne({ name: user }, { $set: { lastStatus: Date.now() } });

        res.sendStatus(200);
    } catch (err) {
        res.status(500).send(err);
    }
});

async function removeInactiveUsers() {
    const threshold = Date.now() - 10000;

    try {
        const inactiveUsers = await db
            .collection("participants")
            .find({ lastStatus: { $lte: threshold } })
            .toArray();

        const messagesToInsert = inactiveUsers.map(user => ({
            from: user.name,
            to: 'Todos',
            text: 'sai da sala...',
            type: 'status',
            time: now()
        }));

        const userNamesToDelete = inactiveUsers.map(user => user.name);

        if (messagesToInsert.length > 0) {
            await db.collection("messages").insertMany(messagesToInsert);
        }

        if (userNamesToDelete.length > 0) {
            await db.collection("participants").deleteMany({ name: { $in: userNamesToDelete } });
        }
    } catch (err) {
        console.log(err);
    }
}

setInterval(removeInactiveUsers, 15000);

app.listen(5000, () => console.log("Server running on port 5000"));
