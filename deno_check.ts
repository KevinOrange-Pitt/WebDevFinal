type User = {
  name: string;
  age: number;
};

function greet(user: User): string {
  return `Hello, ${user.name}. You are ${user.age} years old.`;
}

const person: User = {
  name: "Kevin",
  age: 12,
};

console.log(greet(person));
