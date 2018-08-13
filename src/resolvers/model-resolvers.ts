import { GenerateJob, JobStatus, TrainingJob } from 'fun-with-ml-schema';
import WebSocket from 'ws';
import { BACKEND_URI, MessageKey, Status } from '../backend';
import client from '../db';
import { Event, pubsub } from '../pubsub';
import { Resolvers } from './resolvers';

const generateJobs: { [key: string]: GenerateJob } = {};
const trainingJobs: { [key: string]: TrainingJob } = {};

export const modelResolvers: Resolvers = {
  Mutation: {
    createModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { name } = args.input;

      return client
        .query('INSERT INTO models(name) VALUES ($1) RETURNING *', [name])
        .then(results => results.rows[0]);
    },
    deleteModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id } = args.input;

      return new Promise(resolve => {
        const socket = new WebSocket(BACKEND_URI);

        socket.onmessage = () => {
          socket.close();
          resolve();
        };

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              args: { id },
              key: MessageKey.Delete
            })
          );
        };
      })
        .then(() =>
          client.query('DELETE FROM models WHERE id = $1 RETURNING *', [id])
        )
        .then(() => client.query('SELECT * from models WHERE id = $1', [id]))
        .then(results => results.rows[0]);
    },
    generateTextFromModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { count, id, maxLength, prefix, temperature } = args.input;

      return client
        .query('SELECT * from models WHERE id = $1', [id])
        .then(results => results.rows[0])
        .then(model => {
          if (!model) {
            return null;
          }

          const generateJob = {
            id,
            errors: [],
            status: JobStatus.PENDING,
            text: []
          };
          const text: string[] = [];

          generateJobs[id] = generateJob;

          pubsub.publish(Event.TextGenerated, {
            textGenerated: generateJob
          });

          const socket = new WebSocket(BACKEND_URI);

          socket.onmessage = message => {
            const response = JSON.parse(message.data as string);
            let generateJob: GenerateJob;

            if (response.status == Status.Done) {
              socket.close();
              generateJob = { id, errors: [], status: JobStatus.DONE, text };
            } else if (response.status == Status.Error) {
              generateJob = {
                id,
                errors: [response.results],
                status: JobStatus.ERROR,
                text: []
              };
            } else {
              text.push(response.results);
              generateJob = { id, errors: [], status: JobStatus.ACTIVE, text };
            }

            generateJobs[id] = generateJob;

            pubsub.publish(Event.TextGenerated, {
              textGenerated: generateJob
            });
          };

          socket.onopen = () => {
            socket.send(
              JSON.stringify({
                args: { count, maxLength, model, prefix, temperature },
                key: MessageKey.Generate
              })
            );
          };

          return generateJob;
        });
    },
    trainModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { epochs, force, id, selectors, url } = args.input;
      const initialTrainingJob = { id, errors: [], status: JobStatus.PENDING };

      return client
        .query('SELECT * from models WHERE id = $1', [id])
        .then(results => results.rows[0])
        .then(model => {
          const hasUrl = model && model.urls.indexOf(args.input.url) >= 0;

          if (!model || (!force && hasUrl)) {
            return null;
          }

          trainingJobs[id] = initialTrainingJob;

          pubsub.publish(Event.BatchCompleted, {
            batchCompleted: initialTrainingJob
          });

          if (!hasUrl) {
            const urls = model.urls.concat(url);

            return client
              .query('UPDATE models set urls = $2 where id = $1 RETURNING *', [
                id,
                urls
              ])
              .then(results => results.rows[0]);
          }

          return model;
        })
        .then(model => {
          const socket = new WebSocket(BACKEND_URI);

          socket.onmessage = message => {
            const response = JSON.parse(message.data as string);
            let trainingJob: TrainingJob;

            if (response.status == Status.Done) {
              socket.close();
              trainingJob = { id, errors: [], status: JobStatus.DONE };
            } else if (response.status == Status.Error) {
              trainingJob = {
                errors: [response.results],
                id,
                status: JobStatus.ERROR
              };
            } else {
              trainingJob = {
                ...response.results,
                errors: [],
                id,
                status: JobStatus.ACTIVE
              };
            }

            trainingJobs[id] = trainingJob;

            pubsub.publish(Event.BatchCompleted, {
              batchCompleted: trainingJob
            });
          };

          socket.onopen = () => {
            socket.send(
              JSON.stringify({
                args: { epochs, model, selectors, url },
                key: MessageKey.Train
              })
            );
          };

          return initialTrainingJob;
        });
    },
    updateModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id, name } = args.input;

      return client
        .query('UPDATE models set name = $2 where id = $1 RETURNING *', [
          id,
          name
        ])
        .then(results => results.rows[0]);
    }
  },
  Query: {
    generateJob: (_, args) => (args ? generateJobs[args.input.id] : null),
    model: (_, args) =>
      args
        ? client
            .query('SELECT * FROM models WHERE id = $1', [args.input.id])
            .then(results => results.rows[0])
        : null,
    models: () =>
      client.query('SELECT * FROM models').then(results => results.rows),
    trainingJob: (_, args) => (args ? trainingJobs[args.input.id] : null)
  },
  Subscription: {
    batchCompleted: {
      subscribe: () => pubsub.asyncIterator<TrainingJob>(Event.BatchCompleted)
    },
    textGenerated: {
      subscribe: () => pubsub.asyncIterator<GenerateJob>(Event.TextGenerated)
    }
  }
};
