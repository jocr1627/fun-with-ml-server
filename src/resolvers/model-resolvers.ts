import { GenerateJob, JobStatus, Model, TrainingJob } from 'fun-with-ml-schema';
import WebSocket from 'ws';
import { MessageKey, Status } from '../backend';
import { Event, pubsub } from '../pubsub';
import { Resolvers } from './resolvers';

const generateJobs: { [key: string]: GenerateJob } = {};
const models: { [key: string]: Model } = {};
const trainingJobs: { [key: string]: TrainingJob } = {};
let nextId = 0;

export const modelResolvers: Resolvers = {
  Mutation: {
    createModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { name } = args.input;
      const id = nextId.toString();
      const model = {
        id,
        name,
        urls: []
      };

      nextId += 1;
      models[id] = model;

      return model;
    },
    deleteModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id } = args.input;
      const model = models[id];

      if (!model) {
        return null;
      }

      return new Promise(resolve => {
        const socket = new WebSocket(
          process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
        );

        socket.onmessage = () => {
          socket.close();

          delete models[id];

          resolve();
        };

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              args: { model },
              key: MessageKey.Delete
            })
          );
        };
      });
    },
    updateModel: (_, args) => {
      if (!args) {
        return null;
      }

      const { id, name } = args.input;
      const model = { ...models[id], name };

      models[id] = model;

      return model;
    }
  },
  Query: {
    generateJob: (_, args) => (args ? generateJobs[args.input.id] : null),
    model: (_, args) => (args ? models[args.input.id] : null),
    models: () => Object.keys(models).map(key => models[key]),
    trainingJob: (_, args) => (args ? trainingJobs[args.input.id] : null)
  },
  Subscription: {
    generateTextFromModel: {
      subscribe: (_, args) => {
        const iterator = pubsub.asyncIterator<GenerateJob | null>(
          Event.TextGenerated
        );

        if (!args || !models[args.input.id]) {
          pubsub.publish(Event.TextGenerated, {
            generateTextFromModel: null
          });

          return iterator;
        }

        const { count, id, maxLength, prefix, temperature } = args.input;
        const model = models[id];
        const text: string[] = [];

        const socket = new WebSocket(
          process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
        );

        socket.onmessage = message => {
          const response = JSON.parse(message.data as string);
          let generateJob: GenerateJob;

          if (response.status == Status.Done) {
            socket.close();
            generateJob = { id, status: JobStatus.DONE, text };
          } else {
            text.push(response.results);
            generateJob = { id, status: JobStatus.ACTIVE, text };
          }

          generateJobs[id] = generateJob;

          pubsub.publish(Event.TextGenerated, {
            generateTextFromModel: generateJob
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

        pubsub.publish(Event.TextGenerated, {
          generateTextFromModel: { id, status: JobStatus.PENDING, text }
        });

        return iterator;
      }
    },
    trainModel: {
      subscribe: (_, args) => {
        const iterator = pubsub.asyncIterator<TrainingJob | null>(
          Event.BatchCompleted
        );
        const hasUrl =
          args && models[args.input.id].urls.indexOf(args.input.url) >= 0;

        if (!args || !models[args.input.id] || (!args.input.force && hasUrl)) {
          pubsub.publish(Event.BatchCompleted, {
            trainModel: null
          });

          return iterator;
        }

        const { epochs, id, selectors, url } = args.input;
        const model = models[id];

        if (!hasUrl) {
          const newModel = { ...model, urls: model.urls.concat(url) };

          models[id] = newModel;
        }

        const socket = new WebSocket(
          process.env.BACKEND_ADDRESS || 'ws://localhost:8000'
        );

        socket.onmessage = message => {
          const response = JSON.parse(message.data as string);
          let trainingJob: TrainingJob;

          if (response.status == Status.Done) {
            socket.close();
            trainingJob = { id, status: JobStatus.DONE };
          } else {
            trainingJob = { ...response.results, id, status: JobStatus.ACTIVE };
          }

          trainingJobs[id] = trainingJob;

          pubsub.publish(Event.BatchCompleted, {
            trainModel: trainingJob
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

        pubsub.publish(Event.TextGenerated, {
          trainModel: { id, status: JobStatus.PENDING }
        });

        return iterator;
      }
    }
  }
};
